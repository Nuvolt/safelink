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

        function Agent(cfg) {
            this.id = cfg.id || _.uniqueId('agent_');
            this.version = cfg.version || 100;
            this.url = cfg.endpoint;
            this.timeout = cfg.timeout || 30;
            this.log = cfg.log || bunyan.createLogger({name:'sitelink', level:'info'});
            this.heartbeatSpec = cfg.heartbeat || { interval: 30};
            this.pollingSpec = cfg.polling || { interval: 5 };
            this.commandHandlers = cfg.commandHandlers || {};
            this.eventHandlers = [];
        }

        util.inherits(Agent, events.EventEmitter);

        Agent.prototype.connect = function() {
            var defer = Q.defer();

            this.emit('before-connect');

            dispatch(this, "agent-connect", this.heartbeatSpec, function(err, resp, body) {
                if(err) defer.reject(err);
                else if(resp.statusCode == 200) {

                    this.emit('connected', body);

                    // Launch the heartbeat timer
                    this.heartbeatHandle = setInterval(_.bind(heartbeat, this), this.heartbeatSpec.interval * 1000);

                    // Launch the pending command polling
                    this.pendingCommandHandle = setInterval(_.bind(retrievePendingCommands, this), this.pollingSpec.interval * 1000);

                    this.pendingEventsHandle = setInterval(_.bind(retrievePendingEvents, this), this.pollingSpec.interval * 1000);

                    // Register our command execution handler
                    this.on('command', _.bind(executeCommand, this));

                    defer.resolve(this);
                }
                else
                    defer.reject(resp);
            });

            return defer.promise;
        };

        Agent.prototype.subscribeTo = function(key, fn) {
            var _this = this;

            var handler = _.query.build(this.eventHandlers).and({ key: key }).first();
            if(!handler) {

                dispatch(_this, 'subscribe', {
                    event:key,
                    options:{}
                }, function(err, resp, body) {
                    if(err)
                        _this.log.error(err, "Unable to subscribe to event %s", key);
                    else {
                        if(resp.statusCode === 200) {
                            _this.log.debug("Registering a new event handler for event %s", key);
                            _this.eventHandlers.push({
                                channelId: body.channelId,
                                key: key,
                                handler: fn,
                                scope: _this
                            });
                        }
                        else
                            _this.log.error("Server refuse our subscribe request. status code is %d", resp.statusCode);
                    }
                });
            }
            else
                _this.log.warn("Already subscribed to event %s. Existing subscription will be reused", key);
        };

        Agent.prototype.unsubscribeTo = function(key) {
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

        function executeCommand(command) {
            var _this = this;

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
            this.log.info("Sending heartbeat to our dispatcher");
            var data;

            if(this.heartbeatSpec.payload) {
                if(_.isFunction(this.heartbeatSpec.payload)) {
                    data = this.heartbeatSpec.payload.call(this.heartbeatSpec.scope || this);
                }
                else
                    data = this.heartbeatSpec.payload;

                this.log.debug(data, "Heartbeat payload produced");
            }

            dispatch(this, "heartbeat", {payload: data});
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
                                console.log(e);
                                _this.emit(e.key, e.data);
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
