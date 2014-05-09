/**
 *
 * Copyright 2013 Joel Grenon
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
(function() {
    var util = require('util'),
        request = require('request'),
        Q = require('q'),
        _ = require('lodash'),
        EventEmitter = require('eventemitter3'),
        Layer = require('./transports'),
        shortid = require('shortid'),
        bunyan = require('bunyan');

    require('underscore-query');

    var Agent = (function() {

        /**
         * @class Agent
         * @description Primary client-side abstraction used to establish and manage communication with a central dispatcher
         * @param cfg
         * @constructor
         */
        function Agent(cfg) {
            var id = cfg.id || shortid.generate();

            // Create our transport layer
            this.layer = new Layer(_.extend(_.pick(cfg, 'logLevel'), {logName: id+"-transport-layer"}));

            this.id = id;
            this.version = cfg.version || 100;
            this.url = cfg.endpoint;
            this.timeout = cfg.timeout || 30;
            this.websocket = cfg.websocket || false;
            this.log = cfg.log || bunyan.createLogger({name:id, level:cfg.logLevel || 'info'});
            this.heartbeatSpec = cfg.heartbeat || { interval: 30};
            this.pollingSpec = cfg.polling || { interval: 5 };
            this.commandHandlers = _.defaults(cfg.commandHandlers || {}, {
                configure: simpleCommandHandler(this, 'configure')
            });

            // Add basic event handlers
            this.eventHandlers = [{
                key:'command-progress',
                scope:this,
                handler:onCommandProgress
            }];

            EventEmitter.call(this);
        }

        util.inherits(Agent, EventEmitter);

        /**
         * Called to initiate the heartbeat process and install all transports
         * @return {Promise} resolved when the agent is started
         */
        Agent.prototype.start = function() {
            var _this = this;
            var defer = Q.defer();

            Q.nextTick(function() {
                // Hook to let host perform extra configuration before the agent is started
                 _this.emit('before-start');

                // Register an internal handler to send heartbeat when requested
                _this.on('send-heartbeat', _.bind(heartbeat, _this));

                // Avoid starting automatic heartbeat if our host is requesting manual heartbeat control
                if(!_this.heartbeatSpec.manual) {

                    // Send the first heartbeat
                    _this.emit('send-heartbeat');
                }

                // Launch the pending command polling
                if(_this.pendingCommandHandle)
                    clearInterval(_this.pendingCommandHandle);
                _this.pendingCommandHandle = setInterval(_.bind(retrievePendingCommands, _this), _this.pollingSpec.interval * 1000);

                if(_this.pendingEventsHandle)
                    clearInterval(_this.pendingEventsHandle);
                _this.pendingEventsHandle = setInterval(_.bind(retrievePendingEvents, _this), _this.pollingSpec.interval * 1000);

                // Register our command execution handler
                _this.on('command', _.bind(executeCommand, _this));

                // Establish the web socket connection
                if(_this.websocket) {
                    _this.layer.ws.init(_this.websocket);
                }

                defer.resolve(_this);
            });

            return defer.promise;
        };

        Agent.prototype.stop = function() {
            this.log.debug("Stopping agent %s", this.id);
            this.suspend();
        };

        Agent.prototype.suspend = function(duration) {
            var _this = this;
            this.suspended = true;

            if(this.pendingCommandHandle) {
                this.log.trace("Stopping pending command handler");
                clearInterval(this.pendingCommandHandle);
            }

            if(this.pendingEventsHandle) {
                this.log.trace("Stopping pending event handler");
                clearInterval(this.pendingEventsHandle);
            }

            if(this.nextHeartbeat) {
                this.log.trace("Preventing next heartbeat from firing");
                clearTimeout(this.nextHeartbeat);
            }

            if(this.resumeTimer) {
                this.log.trace("Cancel the resume timer");
                clearTimeout(this.resumeTimer);
            }

            if(duration) {
                this.resumeTimer = setTimeout(function() {
                    _this.resume();
                }, duration * 1000);
            }
        };

        Agent.prototype.resume = function() {
            this.suspended = false;

            // Launch the pending command polling
            if(this.pendingCommandHandle)
                clearInterval(this.pendingCommandHandle);
            this.pendingCommandHandle = setInterval(_.bind(retrievePendingCommands, this), this.pollingSpec.interval * 1000);

            if(this.pendingEventsHandle)
                clearInterval(this.pendingEventsHandle);
            this.pendingEventsHandle = setInterval(_.bind(retrievePendingEvents, this), this.pollingSpec.interval * 1000);

            delete this.resumeTimer;

            if(!this.heartbeatSpec.manual) {
                this.emit('send-heartbeat');
            }
        };

        /**
         * @method connect
         * @param options Supported options are :
         *   - waitForDispatcher: Indicate if the agent will exit of retry connection with the dispatcher indefinitely. Default to false.
         * @obsolete Not used any more since version 0.9.0. Mapped to start.
         * @returns {*}
         */
        Agent.prototype.connect = function(options) {
            return this.start(options);
        };

        /**
         * @method subscribeTo
         * @description Will connect this agent with remote events emitted by the dispatcher. These events may be triggered by the dispatcher or other agents connected
         *  on the network. For now, you can only subscribe to events that are sent to you, but in the future, we will add support for channels to receive 'room-like' messages.
         * @param key {String} The event key we wish to subscribe to remotely
         * @param fn {Function} The handler that will be called when the event is triggered remotely
         * @param options Options modifying the behavior to the function.
         *
         *  - **force** : Avoid reusing a subscription if already in place and
         *  send the request to the dispatcher anyway. This is used when the dispatcher just failed and we are instructed to reconnect our event handlers.
         */
        Agent.prototype.subscribeTo = function(key, fn, options) {
            var promise, _this = this;
            options = options || {};

            var handler = _.query.build(this.eventHandlers).and({ key: key }).first();
            if(!handler || options.force) {

                // Notify the dispatch of our subscription interest
                promise = _this.layer.send(this, 'subscribe',{
                    event:key,
                    options:options
                }, _.pick(options, "timeout"));

                // Perform internal subscription
                promise.then(function() {

                    if(!options.force) {
                        _this.log.debug("Registering a new event handler for event %s", key);
                        _this.eventHandlers.push({
                            key: key,
                            handler: fn,
                            scope: _this
                        });
                    }
                }, function(err) {
                    _this.log.error(err, "Unable to subscribe to event %s", key);
                });

            }
            else
                _this.log.warn("Already subscribed to event %s. Existing subscription will be reused", key);

            return promise;
        };

        /**
         * @method unsubscribeFrom
         * @param key
         */
        Agent.prototype.unsubscribeFrom = function(key) {
            var _this = this, promise;

            var handler = _.query(this.eventHandlers, { key: key });
            if(handler) {

                promise = _this.layer.send(this, 'unsubscribe',  {
                    channelId: handler.channelId,
                    event:key
                });

                promise.then(function() {
                    _this.log.debug("Removing event handler for event %s in channel %s", key, handler.channelId);
                    _this.eventHandlers.remove(handler);
                }, function(err) {
                    _this.log.error(err, "Unable to subscribe to event %s", key);
                });

            }
            else
                _this.log.warn("No subscription found for event %s. Unable to unsubscribe", key);

            return promise;
        };

        /**
         * @method broadcast
         * @description Send a notification to whomever is listening to. This is not directed to a specific agent, but to anyone
         *  on the network, including the dispatcher.
         * @param event {String} The key identifying the event
         * @param payload {Object} The event data
         * @param options Options modifying the behavior of the broadcast.
         * @returns {Promise} A promise resolved as soon as the event has been broadcasted. Nothing is returned (fire and forget)
         */
        Agent.prototype.broadcast = function(event, payload, options) {
            return this.layer.send(this, 'broadcast',{ event:event, payload: payload || {}, options:options }, _.pick(options || {}, "timeout"));
        };

        /**
         * @param key
         * @param options
         */
        Agent.prototype.monitor = function(key, options) {
            return this.layer.send(this, 'start-monitoring', {key:key, interval:options.interval || 5});
        };

        Agent.prototype.cancelMonitoring = function(key) {
            return this.layer.send(this, 'stop-monitoring', {key:key});
        };

        /**
         * @method execute
         * @description Execute a remote command. Depending on the dispatcher context, the command might be executed by
         * the dispatcher itself or by another agent, having registered a remote command handler with the dispacher.
         * @param key The key of the command to execute. It must be registered by the dispatcher or an agent somewhere to receive a response.
         * @param payload The data to send with the command.
         * @param options Options that may change the way the command is executed. Supported options are:
         *
         * - **timeout** : The number of seconds to wait for a response. Default to 30 seconds.
         *
         * @returns {Promise} A promise for the command result.
         */
        Agent.prototype.execute = function(key, payload, options) {
            return this.layer.send(this, 'execute-command', { commandKey:key, payload:payload, options:options||{} }, _.pick(options || {}, "timeout"));
        };

        /**
         * @method executeOn
         * @description Execute a remote command on a specific agent. The command will be forward directly to this agent.
         * @param key The key of the command to execute. It must be registered by the dispatcher or an agent somewhere to receive a response.
         * @param payload The data to send with the command.
         * @param options Options that may change the way the command is executed. Supported options are:
         *
         * - **timeout** : The number of seconds to wait for a response. Default to 30 seconds.
         *
         * @returns {Promise} A promise for the command result.
         */
        Agent.prototype.executeOn = function(agentId, key, payload, options) {
            return this.layer.send(this, 'execute-command-on', { agentId: agentId, commandKey:key, payload:payload || {}, options: options || {} }, _.pick(options || {}, "timeout"));
        };

        /**
         *
         * @param agentId {String|Array} One or more agentIds that should receive this event.
         * @param event {String} The key of the event to send
         * @param payload {Payload} Data that will be associated with this event.
         * @param options {Object} Options that will affect the way the event is emitted
         */
        Agent.prototype.emitTo = function(agentId, event, payload, options) {
            return this.layer.send(this, 'emit-to', { agents: agentId, event:event, payload: payload, options:options }, _.pick(options, "timeout"));
        };

        /**
         * @method registerCommandHandler
         * @description Add or replace a command handler. This handler will be execute each time a command of type **key** will be received.
         * @param key The command key to attach this handler
         * @param fn The handler that will be executed when a command of the specified key is received
         */
        Agent.prototype.registerCommandHandler = function(key, fn) {
            this.log.debug("Register a new command handler %s", key);
            this.commandHandlers = this.commandHandlers || {};
            this.commandHandlers[key] = fn;
        };

        /**
         * @method retrieveCommands
         * @description Force the retrieval of any pending commands from the dispatcher.
         *         *
         * @returns {*}
         */
        Agent.prototype.retrieveCommands = function() {
            var promise, _this = this;

            promise = _this.layer.send(this, 'retrieve-pending-commands');

            promise.then(function(result) {

                if(_.isArray(result.data)) {
                    _this.log.debug("Received %d commands to execute", result.data.length);
                    _.each(result.data, function(command) {
                        _this.log.trace("Executing command %s", command.key);
                        _this.emit('command', command);
                    });
                }
                else {
                    _this.emit('transport-error', {
                        action:'retrieve-pending-commands',
                        error: "Invalid command list"
                    });
                }

            }, function(err) {
                _this.log.error("Unable to retrieve pending commands", err);

                /**
                 * @event network-error
                 * @description Emitted when there is a network problem and we were unable to communicate with the dispatcher.
                 * @param action {String} The name of the action that triggered the error
                 * @param error {Error|String} The actual error that was thrown
                 */
                _this.emit('transport-error', {
                    action:'retrieve-pending-commands',
                    error: err
                });

            }).catch(function(err) {
                _this.log.error("Exception encountered while retrieving pending commands", err);

                /**
                 * @event network-error
                 * @description Emitted when there is a network problem and we were unable to communicate with the dispatcher.
                 * @param action {String} The name of the action that triggered the error
                 * @param error {Error|String} The actual error that was thrown
                 */
                _this.emit('transport-error', {
                    action:'retrieve-pending-commands',
                    error: err
                });

            });

            return promise;
        };

        /**
         * @method retrieveEvents
         * @description Retrieve all pending events for this agent.
         * @param options
         *
         * - delay: The number of seconds we have to wait before retrieving the events. Default to 0.
         * @returns {*}
         */
        Agent.prototype.retrieveEvents = function(options) {
            var promise, _this = this;

            promise = _this.layer.send(this, 'retrieve-pending-events');
            promise.then(function(result) {
                _this.log.trace("Retrieve pending events successfully completed", result);

                if(_.isArray(result.data)) {
                    _this.log.debug("Received %d events to handle", result.data.length);
                    _.each(result.data, function(e) {
                        _this.log.trace("Received event", e);

                        // Notify all registered event handlers
                        //FIXME: Why no use our emitter interface here?
                        var handlers = _.query(_this.eventHandlers, {key: e.key});
                        _.each(handlers, function(h) {
                            h.handler.call(h.scope || _this, e.data);
                        });

                    });
                }
                else {
                    _this.emit('transport-error', {
                        action:'retrieve-pending-events',
                        error: "Invalid event list"
                    });
                }

            }, function(err) {
                _this.log.error("Unable to retrieve pending events", err);

                /**
                 * @event transport-error
                 * @description Emitted when there is a network problem and we were unable to communicate with the dispatcher.
                 * @param action {String} The name of the action that triggered the error
                 * @param error {Error|String} The actual error that was thrown
                 */
                _this.emit('transport-error', {
                    action:'retrieve-pending-events',
                    error: err
                });

            }).catch(function(err){
                _this.log.error("Exception encountered while retrieving pending events", err);

                _this.emit('transport-error', {
                    action:'retrieve-pending-events',
                    error: err
                });
            });

            return promise;
        };

        function executeCommand(command) {
            var _this = this;

            command.timeout = command.timeout || _this.timeout;

            _this.log.debug("Executing command with timeout ", command.timeout);

            // Make sure to parse the payload
            if(_.isString(command.payload)) {
                _this.log.trace("Automatically converting string payload to object using JSON parse");
                try {
                    command.payload = JSON.parse(command.payload);
                }
                catch(err) {
                    _this.log.error("Unable to parse command %s(%s) payload. error=", command.id, command.key, err);
                }
            }

            _this.log.debug("Looking for installed handle for command %s (%s)", command.id, command.key);

            var handler = this.commandHandlers[command.key];
            if(handler) {
                var deferredResponse = Q.defer();

                Q.nextTick(function() {
                    _this.log.trace("Executing command handler", handler);
                    _.bind(handler, _this)(command, deferredResponse);
                });

                _this.log.trace("Waiting for command %s(%s) results for %s seconds", command.id, command.key, _this.timeout);
                Q.timeout(deferredResponse.promise, command.timeout * 1000).then(function(result) {
                    _this.log.debug("Received command %s(%s) result", command.id, command.key);
                    _this.log.trace("Command %s(%s) result = ", command.id, command.key, result);

                    var promise = _this.layer.send(_this, 'command-response', {
                        commandId: command.id,
                        result: result
                    });

                    promise.then(function(){
                        _this.log.trace("Response for command %s(%s) was successfully posted", command.key, command.id);
                    }, function(err) {
                        _this.log.error("Unable to post command-response for command %s(%s)", command.key, command.id, err);
                    });

                    return promise;

                }, function(err) {
                    _this.log.error("Error while processing command %s(%s): ", command.key, command.id, err);
                    _this.layer.send(_this, 'command-error', {commandId: command.id, type: 'timeout', error: err});
                }, function(progress) {
                    _this.log.trace("Progress notification received for command %s(%s)", command.key, command.id);
                    _this.layer.send(_this, "post-command-progress", {commandId: command.id, progress:progress}, {noResponse:true})
                }).catch(function(err) {
                    _this.log.error("Exception! Error while processing command %s(%s): ", command.key, command.id, err);
                    _this.layer.send(_this, 'command-error', {commandId: command.id, type: 'timeout', error: err});
                });

            }
            else {
                _this.log.warn("No handler configured for command %s(%s). We assume that a custom event handler has been installed on the 'command' event", command.key, command.id);
            }
        }

        function heartbeat() {
            var _this = this, data, result;
            _this.log.debug("Sending heartbeat to our dispatcher");

            result = Q.fcall(function() {
                var meta = {meta: {interval: _this.heartbeatSpec.interval}};

                if(_this.heartbeatSpec.payload) {

                    if(_.isFunction(_this.heartbeatSpec.payload)) {
                        _this.log.trace("We have a payload generator function");
                        var payloadDefer = Q.defer();

                        if(_this.heartbeatSpec.payload.length === 1) {
                            var defer = Q.defer();

                            _this.log.debug("Producing deferred payload");

                            // Request the payload
                            _this.heartbeatSpec.payload.call(_this.heartbeatSpec.scope || _this, defer);

                            Q.timeout(defer.promise, (_this.heartbeatSpec.interval-5) * 1000 || 25000).then(function(data) {

                                _this.log.trace(data, "Heartbeat payload produced");
                                payloadDefer.resolve(_this.layer.send(_this, "heartbeat", {payload: data, meta: meta}));

                            }, function(err) {

                                // Send a late heartbeat without a payload
                                _this.log.warn(err, "Unable to produce heartbeat payload. Empty payload will be used", err);
                                payloadDefer.resolve(_this.layer.send(_this, "heartbeat", {meta: meta}));
                            }).catch(function(err) {
                                // Send a late heartbeat without a payload
                                _this.log.warn(err, "Exception! Unable to produce heartbeat payload. Empty payload will be used", err);
                                payloadDefer.resolve(_this.layer.send(_this, "heartbeat", {meta: meta}));
                            });

                            return payloadDefer.promise;
                        }
                        else {
                            _this.log.debug("Producing heartbeat payload synchronously");
                            data = _this.heartbeatSpec.payload.call(_this.heartbeatSpec.scope || _this);
                            _this.log.trace(data, "Heartbeat payload produced");
                            return _this.layer.send(_this, "heartbeat", {payload: data, meta: meta});
                        }

                    }
                    else {
                        _this.log.trace(data, "Heartbeat payload produced");
                        return _this.layer.send(_this, "heartbeat", {payload: _this.heartbeatSpec.payload, meta:meta});
                    }

                }
                else
                    return _this.layer.send(_this, "heartbeat", {meta:meta});
            });

            // Handle result and reprogram next heartbeat
            result.then(function(resp) {
                _this.log.debug("Heartbeat successfully sent", resp);
            }, function(err)    {
                _this.log.error("Unable to send heartbeat", err);
            }).catch(function(err) {
                _this.log.error("Exception! Unable to send heartbeat", err);
            }).finally(function() {
                if(!_this.heartbeatSpec.manual) {
                    _this.log.debug("Programming next heartbeat for %d seconds", _this.heartbeatSpec.interval);
                    _this.nextHeartbeat = setTimeout(function(){ _this.emit('send-heartbeat')}, _this.heartbeatSpec.interval * 1000);
                }
            });

            return result;

        }

        function retrievePendingCommands() {
            this.log.trace("Retrieving pending commands");
            this.retrieveCommands();
        }

        function retrievePendingEvents() {
            this.log.trace("Retrieving pending events");
            this.retrieveEvents();
        }

        function simpleCommandHandler(dispatcher, key) {
            return _.bind(function(command, deferredResult) {
                this.emit(key, command);
                deferredResult.resolve();
            }, dispatcher);
        }

        function onCommandProgress(e) {
            this.log.debug("Received command %s(%s) progress", e.cmd.key, e.cmd.id, e.data);
            var cmd = this.layer.getResult(e.cmd.id);
            if(cmd) {
                this.log.trace("command %s(%s) has been found and progress will be updated", e.cmd.key, e.cmd.id);
                cmd.defer.notify(e.data);
            }
            else
                this.log.warn("command %s(%s) wasn't found in waitingCommands", e.cmd.key, e.cmd.id);
        }

        return Agent;
    })();

    module.exports = Agent;

})();
