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
(function(){
    var util = require('util'),
        request = require('request'),
        Q = require('q'),
        _ = require('lodash'),
        bunyan = require('bunyan'),
        events = require('events');

    require('underscore-query');

    Agent = (function() {

        /**
         * @class Agent
         * @description Primary client-side abstraction used to establish and manage communication with a central dispatcher
         * @param cfg
         * @constructor
         */
        function Agent(cfg) {
            this.id = cfg.id || _.uniqueId('agent_');
            this.version = cfg.version || 100;
            this.url = cfg.endpoint;
            this.timeout = cfg.timeout || 30;
            this.log = cfg.log || bunyan.createLogger({name:this.id, level:cfg.logLevel || 'info'});
            this.heartbeatSpec = cfg.heartbeat || { interval: 30};
            this.pollingSpec = cfg.polling || { interval: 5 };
            this.commandHandlers = _.defaults(cfg.commandHandlers || {}, {
                configure: simpleCommandHandler(this, 'configure')
            });
            this.eventHandlers = [];
        }

        util.inherits(Agent, events.EventEmitter);

        /**
         * @method connect
         * @param options Supported options are :
         *   - waitForDispatcher: Indicate if the agent will exit of retry connection with the dispatcher indefinitely. Default to false.
         * @returns {*}
         */
        Agent.prototype.connect = function(options) {
            var _this = this;
            var defer = Q.defer();

            var retryHandle = setInterval(_doConnect, 5000);
            Q.nextTick(_doConnect);

            function _doConnect() {

                /**
                 * @event before-connect
                 * @description Fired before the agent is connected to the dispatcher.
                 */
                _this.emit('before-connect');

                dispatch(_this, "agent-connect", _this.heartbeatSpec, function(err, resp, body) {

                    if(err) {

                        // If we're not waiting for the dispatcher, let's report an error and stop retrying
                        if(!options.waitForDispatcher) {
                            defer.reject(err);
                            clearInterval(retryHandle);
                        }
                        else
                            _this.log.warn("Dispatcher at url %s is not responding. Retrying in 5 seconds. Remove the waitForDispatcher option to stop automatic retries", _this.url);
                    }
                    else if(resp.statusCode == 200) {

                        try {
                            /**
                             * @event connected
                             * @description Fired when the dispatcher has been reached and accepted our initial connection request. The response
                             *  to the connect call is passed in parameter
                             *  @param response The response of the connect call as sent by the dispatcher
                             */
                            _this.emit('connected', body);

                            // Launch the heartbeat timer
                            _this.heartbeatHandle = setInterval(_.bind(heartbeat, _this), _this.heartbeatSpec.interval * 1000);

                            // Launch the pending command polling
                            _this.pendingCommandHandle = setInterval(_.bind(retrievePendingCommands, _this), _this.pollingSpec.interval * 1000);

                            _this.pendingEventsHandle = setInterval(_.bind(retrievePendingEvents, _this), _this.pollingSpec.interval * 1000);

                            // Register our command execution handler
                            _this.on('command', _.bind(executeCommand, _this));

                        }
                        finally {
                            _this.log.debug("Connection with dispatcher %s successfully established", _this.url);
                            clearInterval(retryHandle);
                            defer.resolve(_this);
                        }
                    }
                    else {
                        if(!options.waitForDispatcher) {
                            defer.reject(resp);
                            clearInterval(retryHandle);
                        }
                        else
                            _this.log.warn("Dispatcher at url %s is not responding. Retrying in 5 seconds. Remove the waitForDispatcher option to stop automatic retries", _this.url);
                    }
                });
            }

            return defer.promise;
        };

        Agent.prototype.disconnect = function() {
            return dispatch(this, 'agent-disconnect');
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
            var _this = this;

            options = options || {};

            var handler = _.query.build(this.eventHandlers).and({ key: key }).first();
            if(!handler || options.force) {

                dispatch(_this, 'subscribe', {
                    event:key,
                    options:{}
                }, function(err, resp) {
                    if(err)
                        _this.log.error(err, "Unable to subscribe to event %s", key);
                    else {
                        if(resp.statusCode === 200) {

                            // We only add a new event handler if the agent was started. Not on a dispatcher restart (force)
                            if(!options.force) {
                                _this.log.debug("Registering a new event handler for event %s", key);
                                _this.eventHandlers.push({
                                    key: key,
                                    handler: fn,
                                    scope: _this
                                });
                            }

                        }
                        else
                            _this.log.error("Server refuse our subscribe request. status code is %d", resp.statusCode);
                    }
                });
            }
            else
                _this.log.warn("Already subscribed to event %s. Existing subscription will be reused", key);
        };

        /**
         * @method unsubscribeFrom
         * @param key
         */
        Agent.prototype.unsubscribeFrom = function(key) {
            var _this = this;

            var handler = _.query(this.eventHandlers, { key: key });
            if(handler) {

                dispatch(this, 'unsubscribe', {
                    channelId: handler.channelId,
                    event:key
                }, function(err, resp, body) {
                    if(err)
                        _this.log.error(err, "Unable to subscribe to event %s", key);
                    else {
                        if(resp.statusCode === 200) {
                            _this.log.debug("Removing event handler for event %s in channel %s", key, handler.channelId);
                            _this.eventHandlers.remove(handler);
                        }
                        else
                            _this.log.error("Server refuse our unsubscribe request. status code is %d", resp.statusCode);
                    }
                });
            }
            else
                _this.log.warn("No subscription found for event %s. Unable to unsubscribe", key);

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
            var _this = this;
            var defer = Q.defer();

            Q.nextTick(function() {
                _this.log.trace("Broadcasting event %s", event);

                dispatch(_this, 'broadcast', {
                    event:event,
                    payload: payload,
                    options:options
                }, function(err, resp) {
                    if(err) defer.reject({success:false, error:err});
                    else if(resp && resp.statusCode >= 400) {
                        defer.reject({
                            success:false,
                            error: "HTTP-ERROR",
                            status:resp.statusCode
                        });
                    }
                    else {
                        defer.resolve({success:true});
                    }
                });

            });

            return defer.promise;
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
            var _this = this;
            var defer = Q.defer();

            Q.nextTick(function(){

                dispatch(_this, 'execute-command', {
                    commandKey:key,
                    payload:payload,
                    options:options||{}
                }, function(err, resp, body){
                    if(err) {
                        defer.reject({success:false, error:err});
                    }
                    else if(resp && resp.statusCode >= 400) {
                        defer.reject({
                            success:false,
                            error:'HTTP-ERROR',
                            status:resp.statusCode
                        });
                    }
                    else {
                        defer.resolve(body);
                    }
                });

            });

            return defer.promise;
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
            var _this = this;
            var defer = Q.defer();

            Q.nextTick(function(){

                dispatch(_this, 'execute-command-on', {
                    agentId: agentId,
                    commandKey:key,
                    payload:payload,
                    options:options||{}
                }, function(err, resp, body) {
                    if(err) {
                        defer.reject({success:false, error:err});
                    }
                    else if(resp && resp.statusCode >= 400) {
                        defer.reject({
                            success:false,
                            error:'HTTP-ERROR',
                            status:resp.statusCode
                        });
                    }
                    else {
                        defer.resolve(body);
                    }
                });

            });

            return defer.promise;
        };

        /**
         *
         * @param agentId {String|Array} One or more agentIds that should receive this event.
         * @param event {String} The key of the event to send
         * @param payload {Payload} Data that will be associated with this event.
         * @param options {Object} Options that will affect the way the event is emitted
         */
        Agent.prototype.emitTo = function(agentId, event, payload, options) {
            var _this = this;
            var defer = Q.defer();

            Q.nextTick(function() {
                _this.log.trace("Emitting event %s", event);

                dispatch(_this, 'emit-to', {
                    agents: agentId,
                    event:event,
                    payload: payload,
                    options:options
                }, function(err, resp) {
                    if(err) defer.reject({success:false, error:err});
                    else if(resp && resp.statusCode >= 400) {
                        defer.reject({
                            success:false,
                            error: "HTTP-ERROR",
                            status:resp.statusCode
                        });
                    }
                    else {
                        defer.resolve({success:true});
                    }
                });

            });

            return defer.promise;
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
         * @param options
         *
         * + delay: Indicate how much time we should wait before retrieving the commands. Default is 0.
         *
         * @returns {*}
         */
        Agent.prototype.retrieveCommands = function(options) {
            var defer = Q.defer();
            options = options || {};

            _.delay(_.bind(function() {

                dispatch(this, 'retrieve-pending-commands', function(err, resp, result) {
                    var _this = this;

                    if(err) {
                        /**
                         * @event network-error
                         * @description Emitted when there is a network problem and we were unable to communicate with the dispatcher.
                         * @param action {String} The name of the action that triggered the error
                         * @param error {Error|String} The actual error that was thrown
                         */
                        this.emit('network-error', {
                            action:'retrieve-pending-commands',
                            error: err
                        });

                        defer.reject({success:false, error:err});
                    }
                    else {
                        if(resp.statusCode === 200) {

                            if(_.isArray(result.data)) {
                                _this.log.debug("Received %d commands to execute", result.data.length);
                                _.each(result.data, function(command) {
                                    _this.log.trace("Executing command %s", command.key);
                                    _this.emit('command', command);
                                });
                                defer.resolve({success:true, count:result.data.length});
                            }
                            else {
                                this.emit('network-error', {
                                    action:'retrieve-pending-commands',
                                    error: "Invalid command list",
                                    status: resp.statusCode,
                                    body: resp.body
                                });
                                defer.reject({success:false, error:'invalid command list', body:resp.body});
                            }

                        }
                        else {
                            this.emit('network-error', {
                                action:'retrieve-pending-commands',
                                error: "HTTP-ERROR",
                                status: resp.statusCode
                            });

                            defer.reject({success:false, error:'HTTP-ERROR', status:resp.statusCode});
                        }
                    }
                });

            }, this), options.delay * 1000 || 0);

            return defer.promise;
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
            var defer = Q.defer();
            options = options || {};

            _.delay(_.bind(function() {

                dispatch(this, 'retrieve-pending-events', function(err, resp, result) {
                    var _this = this;

                    if(err) {
                        this.emit('network-error', {
                            action:'retrieve-pending-events',
                            error: err
                        });
                        defer.reject({success:false, error:err});
                    }
                    else {
                        if(resp.statusCode === 200) {

                            if(_.isArray(result.data)) {
                                _this.log.debug("Received %d events to handle", result.data.length);
                                _.each(result.data, function(e) {
                                    _this.log.trace(e, "Received event");

                                    // Notify all registered event handlers
                                    //FIXME: Why no use our emitter interface here?
                                    var handlers = _.query(_this.eventHandlers, {key: e.key});
                                    _.each(handlers, function(h) {
                                        h.handler.call(h.scope || _this, e.data);
                                    });

                                });

                                defer.resolve({success:true, count: result.data.length});
                            }
                            else {
                                this.emit('network-error', {
                                    action:'retrieve-pending-events',
                                    error: "Invalid event list",
                                    status: resp.statusCode,
                                    body: resp.body
                                });
                                defer.reject({success:false, error:'Invalid event list', status:resp.statusCode, body:resp.body});
                            }
                        }
                        else {
                            this.emit('network-error', {
                                action:'retrieve-pending-events',
                                error: "HTTP-ERROR",
                                status: resp.statusCode
                            });
                            defer.reject({success:false, error:'HTTP-ERROR', status:resp.statusCode});
                        }
                    }
                });

            }, this), options.delay * 1000 || 0);

            return defer.promise;
        };

        function executeCommand(command) {
            var _this = this;

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
                Q.timeout(deferredResponse.promise, _this.timeout * 1000).then(function(result) {
                    _this.log.debug("Received command %s(%s) result", command.id, command.key);
                    _this.log.trace("Command %s(%s) result = ", command.id, command.key, result);

                    dispatch(_this, "command-response", {
                        commandId: command.id,
                        result: result
                    });

                }, function(err) {
                    _this.log.error("Error while processing command %s (%s): ", command.id, command.key, err);
                    dispatch(_this, "command-error", {commandId: command.id, type: 'timeout', error: err});
                });

            }
            else {
                this.log.warn("No handler configured for command %s. We assume that a custom event handler has been installed on the 'command' event", command.key);
            }
        }

        function heartbeat() {
            var _this = this;
            this.log.debug("Sending heartbeat to our dispatcher");
            var data;

            if(this.heartbeatSpec.payload) {

                if(_.isFunction(this.heartbeatSpec.payload)) {

                    // If our payload function expect one parameter, it means it wants to use the deferred result approach
                    if(_this.heartbeatSpec.payload.length == 1) {
                        var defer = Q.defer();
                        Q.nextTick(function() {
                            _this.heartbeatSpec.payload.call(_this.heartbeatSpec.scope || _this, defer);
                            Q.timeout(defer.promise, _this.heartbeatSpec.interval * 1000 || 30000).then(function(data) {
                                _this.log.trace(data, "Heartbeat payload produced");
                                dispatch(_this, "heartbeat", {payload: data});
                            }, function(err) {
                                // Send a late heartbeat without a payload
                                _this.log.warn(err, "Unable to produce heartbeat payload.");
                                dispatch(_this, "heartbeat");
                            });
                        });
                    }
                    else {
                        data = _this.heartbeatSpec.payload.call(this.heartbeatSpec.scope || this);
                        this.log.trace(data, "Heartbeat payload produced");
                        dispatch(this, "heartbeat", {payload: data});
                    }

                }
                else {
                    data = this.heartbeatSpec.payload;
                    this.log.trace(data, "Heartbeat payload produced");
                    dispatch(this, "heartbeat", {payload: data});
                }

            }
            else
                dispatch(this, "heartbeat");
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

        /**
         * @method dispatch
         * @private
         * @description Helper used to package a command to the dispatcher. Will apply the right format and properly handle results, including errors.
         * @param agent
         * @param key
         * @param payload
         * @param callback The callback that will be called when we receive the result (or error)
         * @returns {*}
         */
        function dispatch(agent, key, payload, callback) {

            if(_.isFunction(payload)) {
                callback = payload;
                payload = {};
            }
            else if(arguments.length === 2) {
                payload = {};
            }

            return request({
                url: agent.url,
                method:'POST',
                body: _.extend(payload, {key:key, v: agent.version, id: agent.id}),
                json:true,
                timeout:agent.timeout * 1000
            }, function(err, resp, body) {
                if(callback) {
                    _.bind(callback, agent)(err, resp, body);
                }
                else {
                    agent.log.trace("No callback, emitting the response");

                    if(err || resp.statusCode >= 400)   {

                        agent.log.error("Error received from server, but no callback was provided. %s", err);
                        if(resp)
                            agent.log.error("Status code is %d", resp.statusCode);

                        agent.emit('error', {
                            key: key,
                            error: err,
                            resp: resp
                        });

                    }
                    else {
                        agent.emit('dispatcher-response', {
                            key:key,
                            body: body
                        });
                    }
                }
            });

        }

        return Agent;
    })();

    module.exports = Agent;

})();
