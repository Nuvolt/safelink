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
        http = require('http'),
        Q = require('q'),
        shortId = require('shortid'),
        _ = require('lodash'),
        moment = require('moment'),
        redis = require('redis'),
        async = require('async'),
        bunyan = require('bunyan'),
        WatchDog = require('./watchdog'),
        events = require('events');

    require("underscore-query");

    Dispatcher = (function()    {

        var server;

        const protocolMap = require('./protocol');
        const VERSION = 100;
        const pendingCommands = [];
        const watchDogs = {};

        /**
         * @class Dispatcher
         * @extend EventEmitter
         * @description The dispatcher is responsible for central coordination of all agents. It monitors their liveness and make sure they can communication between one and other.
         * The Dispatcher is an {EventEmitter} and will make sure events are remotely replicated between agents.
         * @param cfg
         * @constructor
         */
        function Dispatcher(cfg) {
            var _this = this;
            this.port = cfg.port || 8080;
            this.log = cfg.log || bunyan.createLogger({name:'dispatcher', level: 'trace'});
            this.commandHandlers = {};

            this.db = redis.createClient(cfg.redis);
            this.db.on('error', _.bind(function(e) {

                /**
                 * @event internal.db.error
                 * @description Triggered if the internal Redis database cannot be accessed.
                 * @param e {Error} The error that has been sent.
                 */
                this.emit('internal.db.error', e);

            }, this));

            this.eventSubscriptions = [];

            server = http.createServer(function(req, res) {

                if (req.method == 'POST') {
                    var body = '';
                    req.on('data', function (data) {
                        body += data;
                    });
                    req.on('end', function () {
                        var content = JSON.parse(body);

                        // Do something...
                        var handler = protocolMap[content.key];
                        if(handler) {
                            Q.fcall(_.bind(handler, _this), content).then(function(result) {
                                res.end(JSON.stringify({success:true, v:VERSION, data: result}));
                            }, function(err) {
                                res.end(JSON.stringify({success:false, v:VERSION, error:err}));
                            });
                        }
                        else {
                            res.end(JSON.stringify({success:false, error:'unknown-key', v:VERSION}));
                        }
                    });
                }
                else
                    res.end("error");
            });

            // Launch a command cleanup job to clear completed and lost commands
            this.commandMonitorInterval = setInterval(function() {
                _this.log.debug("Analyzing %d pending commands for cleanup", pendingCommands.length);

                var activeOrCompletedCommands = _.query(pendingCommands, {status:{ $ne : 'PENDING'}});

                _this.log.debug("Found %d candidate commands for cleanup (completed or dead)", activeOrCompletedCommands.length);

                async.forEach(activeOrCompletedCommands, function(cmd, callback) {
                    var delta = moment().utc().unix() - cmd.ts;
                    _this.log.trace(cmd, "Checking command for cleanup");

                    // First process active commands with no results
                    if(cmd.status === 'ACTIVE' && delta > 60) {
                        cmd.defer.reject(new Error("no-response"));
                        cmd.status = 'COMPLETE';
                        _this.log.warn("Command %s is now dead and will be cleaned-up", cmd.id);
                    }

                    if(cmd.status === 'COMPLETE') {
                        _this.log.trace("Cleaning completed command %s", cmd.id);

                        // Remove from pendingCommands
                        pendingCommands.remove(cmd);

                        // Remove from Redis
                        _this.db.del(cmd.id);

                        _this.log.trace("Command %s has been removed from system", cmd.id);
                    }

                    callback();

                }, function(err) {
                    if(err)
                        _this.log.error(err, "There was a problem while we were cleaning up commands... error is", err);
                    else
                        _this.log.debug("Cleanup report: %d remaining pending commands after cleanup", pendingCommands.length);
                });

            }, 30000);

        }

        util.inherits(Dispatcher, events.EventEmitter);

        /**
         * @method listen
         * @description Connect the HTTP server to the configured port.
         * @returns {Promise} Resolved when the dispatcher is ready to receive commands.
         */
        Dispatcher.prototype.listen = function() {
            var defer = Q.defer();
            server.listen(this.port, defer.makeNodeResolver());
            return defer.promise;
        };

        /**
         * @method listPendingCommands
         * @description List all pending commands for a specific agent
         * @param agentId {String} An agentId
         * @returns {Array} A list of pending commands. Each command has the following fields:
         *
         * - id
         * - agentId
         * - defer: The deferred result
         * - status: the status of the command : PENDING | ACTIVE | COMPLETE
         * - ts : The unix timestamp when this command was created
         */
        Dispatcher.prototype.listPendingCommands = function(agentId) {
            return _.query(pendingCommands, {agentId:agentId, status: 'PENDING'});
        };

        /**
         * @method executeOnAgent
         * @description Execute a command on a specific agent
         * @param agentId {String} The agentId where the command will be executed
         * @param commandKey {String} The command key that identified this command
         * @param payload {Object} The data that will be passed with the command
         * @returns {Promise} A promise providing access to the command result when available.
         */
        Dispatcher.prototype.executeOnAgent = function(agentId, commandKey, payload) {
            var _this = this;
            var defer = Q.defer();

            Q.nextTick(_.bind(function() {
                var cmdId = shortId.generate();
                var ts = moment().utc().unix();

                this.log.debug("Executing command %s(%s) on agent %s", commandKey, cmdId, agentId);
                this.log.trace("Executing command %s(%s) with payload", commandKey, cmdId, payload);

                this.db.multi()
                    .hset(cmdId, "id", cmdId)
                    .hset(cmdId, "key", commandKey)
                    .hset(cmdId, "agent", agentId)
                    .hset(cmdId, "ts", ts)
                    .hset(cmdId, "payload", JSON.stringify(payload))
                    .exec(function(err) {
                        if(err) {
                            _this.log.error("Unable to register command in Redis", err);
                            defer.reject(err);
                        }
                        else {
                            _this.log.debug("Adding command %s(%s) to pending command list for agent %s", commandKey, cmdId, agentId);

                            // Add this command to our pending list
                            pendingCommands.push({
                                id:cmdId,
                                agentId: agentId,
                                defer:defer,
                                status: 'PENDING',
                                ts: ts
                            });

                        }
                    });

            }, this));

            return defer.promise;
        };

        /**
         * @method emitTo
         * @description Emit an event to a specific agent only.
         * @param agentId {String|Array} The agent where the event is to be sent. This may be an array of agentIds.
         * @param key {String} The event key that is being sent
         * @param data The event payload
         * @param options
         * @returns {Promise} A promise resolved when the event has been retrieved by the agent (or agents)
         */
        Dispatcher.prototype.emitTo = function(agentId, key, data, options) {
            var _this = this;
            var defer = Q.defer();
            options = options || {};
            Q.nextTick(function() {
                if(_.isString(agentId)) agentId = [agentId];
                async.forEach(agentId, function(id, done){
                    _this.db.rpush(id+"_events", JSON.stringify({key: key, data:data}));
                }, function(err) {
                    if(err) defer.reject(err);
                    else
                        defer.resolve();
                });
            });
            return defer.promise;
        };

        /**
         * @method applyCommandResponse
         * @description Called when an agent has sent back the response to an active command. This will apply the response and resolve the
         * associated promise.
         * @param cmdId The id of the command associated with the response
         * @param result The actual command response
         * @returns {defer.promise|*} The promise associated with the applyCommand operation and not the promise associated with the command itself.
         */
        Dispatcher.prototype.applyCommandResponse = function(cmdId, result) {
            var defer = Q.defer();
            Q.nextTick(function() {
                var commands = _.query(pendingCommands, {id:cmdId});
                if(commands.length == 1) {
                    commands[0].defer.resolve(result);
                    commands[0].status = 'COMPLETE';
                    defer.resolve({success:true});
                }
                else {
                    defer.reject({success:false, error:"Unknown command:"+cmdId});
                }
            });

            return defer.promise;
        };

        Dispatcher.prototype.applyCommandError = function(cmdId, error) {
            var defer = Q.defer();
            Q.nextTick(function() {
                var commands = _.query(pendingCommands, {id:cmdId});
                if(commands.length == 1) {
                    commands[0].defer.reject(error);
                    commands[0].status = 'COMPLETE';
                    defer.resolve({success:true});
                }
                else {
                    defer.reject({success:false, error: "Unknown command:"+cmdId});
                }
            });

            return defer.promise;
        };

        Dispatcher.prototype.startAgentWatchDog = function(agent) {
            var _this = this;
            var defer = Q.defer();

            Q.nextTick(function() {
                watchDogs[agent.id] = new WatchDog(agent, _this);
                _this.log.debug("Watchdog installed for agent %s", agent.id);
                defer.resolve(watchDogs[agent.id]);
            });

            return defer.promise;
        };

        Dispatcher.prototype.stopAgentWatchDog = function(agentId) {
            clearInterval(watchDogs[agentId]);
        };

        Dispatcher.prototype.ensureWatchDog = function(agent){
            if(!watchDogs[agent.id]) {
                return this.startAgentWatchDog(agent);
            }
            return Q.when(watchDogs[agent.id]);
        };

        Dispatcher.prototype.hasWatchDog = function(agentId) {
            return !_.isUndefined(watchDogs[agentId]);
        };

        return Dispatcher;
    })();

    module.exports = Dispatcher;

})();
