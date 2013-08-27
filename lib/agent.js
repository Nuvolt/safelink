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
        _ = require('underscore'),
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
            this.log = cfg.log || bunyan.createLogger({name:'sitelink', level:cfg.logLevel || 'info'});
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
         * @param options
         * @returns {*}
         */
        Agent.prototype.connect = function(options) {
            var _this = this;
            var defer = Q.defer();

            this.emit('before-connect');

            var retryHandle = setInterval(_doConnect, 5000);
            Q.nextTick(_doConnect);

            function _doConnect() {

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

        /**
         * @method subscribeTo
         * @param key
         * @param fn
         * @param options
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
         * @param event
         * @param payload
         * @param options
         * @returns {*}
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
         * @param key
         * @param payload
         * @param options
         * @returns {*}
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
         * @method registerCommandHandler
         * @param key The command key to attach this handler
         * @param fn The handler that will be executed when a command of the specified key is received
         */
        Agent.prototype.registerCommandHandler = function(key, fn) {

        };

        function executeCommand(command) {
            var _this = this;

            // Make sure to parse the payload
            if(_.isString(command.payload)) {
                try {
                    command.payload = JSON.parse(command.payload);
                }
                catch(err) {
                    _this.log.error("Unable to parse command %s(%s) payload. error=", command.id, command.key, err);
                }
            }

            var handler = this.commandHandlers[command.key];
            if(handler) {
                var deferredResponse = Q.defer();

                Q.nextTick(function() {
                    _.bind(handler, _this)(command, deferredResponse);
                });

                Q.timeout(deferredResponse.promise, _this.timeout * 1000).then(function(result) {

                    dispatch(_this, "command-response", {
                        commandId: command.id,
                        result: result
                    });

                }, function(err) {
                    dispatch(_this, "command-error", {commandId: command.id, type: 'timeout', error: err});
                });

            }
            else {
                this.log.warn("No handler configured for command %s. We assume that a custom event handler has been installed on the 'command' event", command.key);
            }
        }

        function heartbeat() {
            var _this = this;
            this.log.info("Sending heartbeat to our dispatcher");
            var data;

            if(this.heartbeatSpec.payload) {

                if(_.isFunction(this.heartbeatSpec.payload)) {

                    // If our payload function expect one parameter, it means it wants to use the deferred result approach
                    if(_this.heartbeatSpec.payload.length == 1) {
                        var defer = Q.defer();
                        Q.nextTick(function() {
                            _this.heartbeatSpec.payload.call(_this.heartbeatSpec.scope || _this, defer);
                            Q.timeout(defer.promise, 10000).then(function(data) {
                                _this.log.debug(data, "Heartbeat payload produced");
                                dispatch(_this, "heartbeat", {payload: data});
                            }, function(err) {
                                // Send a late heartbeat without a payload
                                _this.log.warn(err, "Unable to produce heartbeat.");
                                dispatch(_this, "heartbeat");
                            });
                        });
                    }
                    else {
                        data = _this.heartbeatSpec.payload.call(this.heartbeatSpec.scope || this);
                        this.log.debug(data, "Heartbeat payload produced");
                        dispatch(this, "heartbeat", {payload: data});
                    }

                }
                else {
                    data = this.heartbeatSpec.payload;
                    this.log.debug(data, "Heartbeat payload produced");
                    dispatch(this, "heartbeat", {payload: data});
                }

            }
            else
                dispatch(this, "heartbeat");
        }

        function retrievePendingCommands() {
            this.log.trace("Retrieving pending commands");

            dispatch(this, 'retrieve-pending-commands', function(err, resp, result) {
                var _this = this;

                if(err) {
                    this.emit('network-error', {
                        action:'retrieve-pending-commands',
                        error: err
                    });
                }
                else {
                    if(resp.statusCode === 200) {
                        if(_.isArray(result.data)) {
                            _this.log.debug("Received %d commands to execute", result.data.length);
                            _.each(result.data, function(command) {
                                _this.emit('command', command);
                            });
                        }
                        else {
                            this.emit('network-error', {
                                action:'retrieve-pending-commands',
                                error: "Invalid command list",
                                status: resp.statusCode,
                                body: resp.body
                            });
                        }
                    }
                    else {
                        this.emit('network-error', {
                            action:'retrieve-pending-commands',
                            error: "HTTP-ERROR",
                            status: resp.statusCode
                        });
                    }
                }
            });
        }

        function retrievePendingEvents() {
            this.log.trace("Retrieving pending events");

            dispatch(this, 'retrieve-pending-events', function(err, resp, result) {
                var _this = this;

                if(err) {
                    this.emit('network-error', {
                        action:'retrieve-pending-events',
                        error: err
                    });
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
                        }
                        else {
                            this.emit('network-error', {
                                action:'retrieve-pending-events',
                                error: "Invalid event list",
                                status: resp.statusCode,
                                body: resp.body
                            });
                        }
                    }
                    else {
                        this.emit('network-error', {
                            action:'retrieve-pending-events',
                            error: "HTTP-ERROR",
                            status: resp.statusCode
                        });
                    }
                }
            });
        }

        function simpleCommandHandler(dispatcher, key) {
            return _.bind(function(command, deferredResult) {
                this.emit(key, command);
                deferredResult.resolve();
            }, dispatcher);
        }

        function dispatch(agent, key, payload, callback) {
            if(_.isFunction(payload)) {
                callback = payload;
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
