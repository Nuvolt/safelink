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
var util = require('util'),
    http = require('http'),
    Q = require('q'),
    /* jshint ignore:start */
    JSON = require('json3'),
    /* jshint ignore:end */
    shortId = require('shortid'),
    _ = require('lodash'),
    moment = require('moment'),
    redis = require('redis'),
    async = require('async'),
    bunyan = require('bunyan'),
    WebSocketServer = require('ws').Server,
    WatchDog = require('./watchdog'),
    EventEmitter = require('eventemitter3');

require("underscore-query");

var Dispatcher = (function()    {

    var server;

    const protocolMap = require('./protocol');
    const VERSION = 100;
    const pendingCommands = [];
    const watchDogs = {};
    const monitors = {};

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
        this.log = cfg.log || bunyan.createLogger({name:'dispatcher', level: cfg.logLevel || 'info'});
        this.pendingCleanupThreshold = cfg.command_cleanup_threshold || 600;
        this.commandHandlers = {};
        this.agentSockets = {};

        EventEmitter.call(this);

        if(!cfg.redis) {
            cfg.redis = {
                port: 6379,
                host: 'localhost'
            }
        }

        this.db = redis.createClient(cfg.redis.port, cfg.redis.host);

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

            if(_this.suspended) {
                res.statusCode = 503;
                res.end("SUSPENDED");
            }
            else {
                if (req.method === 'POST') {
                    var body = '';
                    req.on('data', function (data) {
                        body += data;
                    });
                    req.on('error', function(err) {
                        _this.log.error(err);
                        res.send("error");
                    });
                    req.on('end', function () {
                        var content = {};
                        if(body.length > 0) {
                            try {
                                content = JSON.parse(body);

                                // Do something...
                                var handler = protocolMap[content.key];
                                if(handler) {
                                    Q.fcall(_.bind(handler, _this), content).then(function(result) {
                                        res.end(JSON.stringify({success:true, v:VERSION, data: result}));
                                    }, function(err) {
                                        res.end(JSON.stringify({success:false, v:VERSION, error:err}));
                                    }).catch(function(err) {
                                        res.end(JSON.stringify({success:false, v:VERSION, error:err}));
                                    });
                                }
                                else {
                                    res.end(JSON.stringify({success:false, error:'unknown-key:'+content.key, v:VERSION}));
                                }
                            }
                            catch(err) {
                                _this.log.error(err);
                            }

                        }

                    });
                }
                else
                    res.end(JSON.stringify({success:false, v:VERSION, error:"Unsupported method"}));
            }
        });

        server.on('connection', function(socket) {
            socket.setTimeout(300 * 1000);
        });

        // Initialize the WebSocket server
        if(cfg.wss) {
            var wss = new WebSocketServer({port: cfg.wss.port});

            // Handle agent connections. Register all message handlers
            wss.on('connection', function(ws) {

                ws.on('message', function(msg) {
                    try {
                        var content = JSON.parse(msg);
                        // Bind this socket to an agent id
                        _this.agentSockets[content.id] = ws;

                        _this.log.trace("Received message through websocket", content);

                        // Do something...
                        var handler = protocolMap[content.key];
                        if(handler) {

                            Q.fcall(_.bind(handler, _this), content).then(function(result) {
                                // Write response through the ws
                                ws.send(JSON.stringify({
                                    key: 'message-response',
                                    uuid: content.uuid,
                                    data: result
                                }));
                            }, function(err) {
                                // Write error through the ws
                                ws.send(JSON.stringify({
                                    key:'message-error',
                                    uuid: content.uuid,
                                    error: err
                                }));
                            }).catch(function(err) {
                                // Write error through the ws
                                ws.send(JSON.stringify({
                                    key:'message-error',
                                    uuid: content.uuid,
                                    error: err
                                }));
                            });
                        }
                        else
                            _this.log.warn("No handler was configured for command", content.key);
                    }
                    catch(err) {
                        _this.log.error(err);
                    }

                });

                ws.on('close', function(ws) {
                    _this.log.warn("TODO: Closing socket:",ws);
                });
            });
        }

        // Launch a command cleanup job to clear completed and lost commands
        this.commandMonitorInterval = setInterval(function() {
            _this.log.debug("Analyzing %d pending commands for cleanup", pendingCommands.length);

            var activeOrCompletedCommands = _.query(pendingCommands, {status:{ $ne : 'PENDING'}});

            _this.log.debug("Found %d candidate commands for cleanup (completed or dead)", activeOrCompletedCommands.length);

            async.forEach(activeOrCompletedCommands, function(cmd, callback) {
                var delta = moment().utc().unix() - cmd.ts;
                _this.log.trace(cmd, "Checking command for cleanup");

                // First process active commands with no results
                if(cmd.status === 'ACTIVE' && delta > _this.pendingCleanupThreshold) {
                    cmd.defer.reject(new Error("no-response"));
                    cmd.status = 'COMPLETE';
                    _this.log.warn("Command %s(%s) for agent %s is now dead and will be cleaned-up", cmd.id, cmd.key, cmd.agentId);
                }

                if(cmd.status === 'COMPLETE') {
                    _this.log.trace("Cleaning completed command %s", cmd.id);

                    // Remove from pendingCommands
                    _.remove(pendingCommands, function(c){ return c.id === cmd.id });

                    // Remove from Redis
                    _this.db.del(cmd.id);

                    _this.log.trace("Command %s:%s(%s) has been removed from system", cmd.agentId, cmd.id, cmd.key);
                }

                callback();

            }, function(err) {
                if(err)
                    _this.log.error(err, "There was a problem while we were cleaning up commands... error is", err);
                else
                    _this.log.debug("Cleanup report: %d remaining pending commands after cleanup", pendingCommands.length);
            });

        }, 30000);

        this.on('agent-connected', function(e) {

            e.meta = e.meta || {};
            e.agent = e.agent || {};

            // Create a new structure for this agent
            this.db.multi()
                .hset(e.id, "connectedTs", e.ts)
                .hset(e.id, "lastHeartbeatTs", e.ts)
                .hset(e.id, "version", e.agent.version || "1")
                .hset(e.id, "heartbeat-interval", e.meta.interval || 30)
                .exec(function(err) {
                    if(err)
                        _this.log.error(err);
                    else {
                        _this.ensureWatchDog({id: e.id, interval: e.meta.interval || 30}).then(function(watchdog) {

                            // Force the execution of a configure command on the agent
                            _this.executeOnAgent(e.id, 'configure', {restart: false});
                        }, function(err) {
                            _this.log.warn("Unable to install watchdog for agent %s. Error = ", e.id, err);
                        });
                    }
                });
        });

        this.on('agent-disconnected', function(e) {
            _this.log.warn("Agent %s was detected as disconnected", e.id);

            // Clear all pending commands and mark them as canceled

            // Close any open web socket connection
            if(_this.agentSockets[e.id]) {
                _this.agentSockets[e.id].close();
                delete _this.agentSockets[e.id];
            }

        });

    }

    util.inherits(Dispatcher, EventEmitter);

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

    Dispatcher.prototype.suspend = function(duration) {
        var _this = this;
        if(!this.suspended) {
            this.suspended = true;
            this.log.warn("Dispatcher is now suspended");
            if(duration) {
                setTimeout(function() {
                    _this.resume();
                }, duration * 1000);
            }
        }
        else
            this.log.debug("Already suspended, new suspend request will be ignored");
    };

    Dispatcher.prototype.resume = function() {
        if(this.suspended) {
            this.suspended = false;
            this.log.warn("Dispatcher is now resuming normal operation");
        }
        else
            this.log.info("Dispatcher was already executing normally. Resume request will be ignored");
    };

    /**
     * {
            agent:request.id,
            key:request.payload.key,
            interval: request.payload.interval || 5,
            snapshots: request.payload.snapshots || "ALL"
        }
     *
     * @param cfg
     */
    Dispatcher.prototype.installMonitor = function(cfg) {

        if(!monitors[cfg.agent]) {
            monitors[cfg.agent] = setInterval(_.bind(function() {
                var snapshot = {
                    agents:this.listConnectedAgents(),
                    pendingCommands:this.listPendingCommands(cfg.agent).length
                };

                // Send a system-status event to the agent
                this.emitTo(cfg.agent, snapshot);

            }, this), cfg.interval);
        }
        else
            return Q(monitors[cfg.agent]);
    };

    Dispatcher.prototype.uninstallMonitor = function(agent, key) {
        if(monitors[agent]) {
            clearInterval(monitors[agent]);
            delete monitors[agent];
        }
    };

    Dispatcher.prototype.listConnectedAgents = function() {
        return _.map(_.values(watchDogs), function(w) {
            return w.agent;
        });
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
        return _.q(pendingCommands, {agentId:agentId, status: 'PENDING'});
    };

    /**
     * Execute a command on a specific agent
     *
     * @method executeOnAgent
     * @param agentId {String} The agentId where the command will be executed
     * @param commandKey {String} The command key that identified this command
     * @param payload {Object} The data that will be passed with the command
     * @param options {Object} Contains options that affects the way the command is executed
     * @returns {Promise} A promise providing access to the command result when available.
     */
    Dispatcher.prototype.executeOnAgent = function(agentId, commandKey, payload, options) {
        var _this = this;
        var defer = Q.defer();

        options = options || {};
        payload = payload || {};

        Q.nextTick(_.bind(function() {
            var cmdId = options.uuid || shortId.generate();
            var ts = moment().utc().unix();

            this.log.debug("Executing command %s(%s) on agent %s", commandKey, cmdId, agentId);
            this.log.trace("Executing command %s(%s) with payload", commandKey, cmdId, payload);

            // We default to single command group
            var group = cmdId;

            // If a group is specified, we group commands based on their key by default or using a custom key provided by the caller
            if(options && options.group) {
                group = options.group.key || agentId+commandKey;
            }

            // Make sure we drop all pending requests (from other groups) if we're instructed to
            if(options && options.dropAllPending) {

                if(_.isString(options.dropAllPending)) {
                    _.each(_.query(pendingCommands, {agentId:agentId, key:options.dropAllPending, group: {$ne : group}, status:'PENDING'}), function(command) {
                        command.defer.resolve({success:true, dropped:true});
                        command.status = 'COMPLETE';
                    });
                }
                else {
                    _.each(_.query(pendingCommands, {agentId:agentId, group: {$ne : group}, status:'PENDING'}), function(command) {
                        command.defer.resolve({success:true, dropped:true});
                        command.status = 'COMPLETE';
                    });
                }

            }

            this.db.multi()
                .hset(cmdId, "id", cmdId)
                .hset(cmdId, "key", commandKey)
                .hset(cmdId, "agent", agentId)
                .hset(cmdId, "ts", ts)
                .hset(cmdId, "group", group)
                .hset(cmdId, "payload", JSON.stringify(payload || {}))
                .hset(cmdId, "options", JSON.stringify(options || {}))
                .exec(function(err) {
                    if(err) {
                        _this.log.error("Unable to register command in Redis", err);
                        defer.reject(err);
                    }
                    else {
                        _this.log.debug("Adding command %s(%s) to pending command list for agent %s", commandKey, cmdId, agentId);

                        // Add this command to our pending list
                        var cmd = {
                            id:cmdId,
                            agentId: agentId,
                            key: commandKey,
                            defer:defer,
                            group: group,
                            status: 'PENDING',
                            timeout: options.timeout || _this.timeout,
                            ts: ts
                        };

                        pendingCommands.push(cmd);
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
                done();
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
        var _this = this;
        var defer = Q.defer();
        Q.nextTick(function() {
            _this.log.debug("Applying command response for command %s", cmdId);
            _this.log.trace("Command %s response", result);

            var commands = _.query(pendingCommands, {id:cmdId});
            if(commands.length === 1) {
                _this.log.debug("Command %s was successfully found in our pending command list", cmdId);
                _this.log.trace("Command found", commands[0]);

                // We load all commands of the same group. They will all be resolved by the same result (including this one)
                var groupCommands = _.query(pendingCommands, {group: commands[0].group, status: 'PENDING'});
                groupCommands.push(commands[0]);

                _this.log.debug("Found %d commands that will be fulfilled by this response", groupCommands.length);
                async.forEach(groupCommands, function(command, done) {
                    _this.log.trace("Fulfilling command %s(%s)", command.key, command.id);
                    command.defer.resolve(result);
                    command.status = 'COMPLETE';
                    done();
                }, function() {
                    _this.log.debug("Command response was successfully applied");
                    defer.resolve({success:true});
                });
            }
            else {
                _this.log.warn("Unable to find command %s in our pending command list. Most probably a timeout and command was already cleaned up", cmdId);
                defer.reject({success:false, error:"Unknown command:"+cmdId});
            }
        });

        return defer.promise;
    };

    Dispatcher.prototype.applyCommandError = function(cmdId, error) {
        var defer = Q.defer();
        Q.nextTick(function() {
            var commands = _.query(pendingCommands, {id:cmdId});
            if(commands.length === 1) {

                var groupCommands = _.query(pendingCommands, {group: commands[0].group, status: 'PENDING'});
                groupCommands.push(commands[0]);

                async.forEach(groupCommands, function(command, done) {
                    command.defer.reject(error);
                    command.status = 'COMPLETE';
                    done()
                }, function() {
                    defer.resolve({success:true});
                });
            }
            else {
                defer.reject({success:false, error: "Unknown command:"+cmdId});
            }
        });

        return defer.promise;
    };

    Dispatcher.prototype.applyCommandProgress = function(cmdId, progress) {
        var defer = Q.defer();
        Q.nextTick(function() {
            var commands = _.query(pendingCommands, {id:cmdId});
            if(commands.length === 1) {

                var groupCommands = _.query(pendingCommands, {group: commands[0].group, status: 'PENDING'});
                groupCommands.push(commands[0]);

                async.forEach(groupCommands, function(command, done) {
                    command.defer.notify({cmd: _.pick(command, "id", "key", "group"), data:progress});
                    done();
                }, function() {
                    defer.resolve();
                });
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
            _this.log.info("Watchdog installed for agent %s", agent.id);
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
        return Q(watchDogs[agent.id]);
    };

    Dispatcher.prototype.hasWatchDog = function(agentId) {
        return !_.isUndefined(watchDogs[agentId]);
    };

    return Dispatcher;
})();

module.exports = Dispatcher;
