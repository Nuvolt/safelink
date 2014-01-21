(function(){

    var Agent = require("../index").Agent,
        _ = require('lodash'),
        bunyan = require('bunyan'),
        moment = require('moment');

    var log = bunyan.createLogger({name:'main', level: 'debug'});

    /**
     * Create a SiteLink agent to handle communication for this client
     *
     * @type {Agent}
     */
    var agent = new Agent({
        version:100,
        id: "a0e8d636-1378-4fd3-acfd-654e591d6893",
        heartbeat:{
            interval: 20,
            payload: function(deferred) {
                deferred.resolve({
                    gateways:{
                        101:{
                            500: "test",
                            501: "test2"
                        }
                    }
                });
            }
        },
        endpoint:"http://localhost:9090/agent",
        log: log.child({level:'trace'}),
        commandHandlers:{
            "switch-server": switchServer,
            'multimeter': multimeter
        },
        channels:['system']
    });

    agent.start().then(function(connection) {

        // Register to network events
        connection.on('heartbeat', function(e) {
            if(!e.success) {
                this.log.warn("We were unable to send our heartbeat for %d consecutive times", e.count);
                connection.emit("agent-disconnected", {ts:moment().utc.unix()});
            }
            else {
                this.log.info("Heartbeat was successful. Received %d admin commands that will be processed by the agent", e.response.commands.length);
            }
        });

        connection.on('command', function(command) {
            console.log("Received command: ", command.key);
        });

        connection.on('network-error', function(err) {
            agent.log.error(err, "Network Communication Error");
        });

        connection.on('error', function(err) {
            agent.log.error(err, "General Error");
        });

        connection.on('configure', function(command) {
            console.dir(command);
            agent.log.info("Configuring this agent connection. This is the time to connect event handlers");
            if(command.payload.restart)
                agent.log.warn("Dispatcher was restarted, we need to force our subscription back");
            else
                agent.log.debug("Agent was started, no need to force subscriptions");

            connection.subscribeTo('custom', function(data) {
                agent.log.info(data, "Received custom event with attached data");
            }, {force: command.payload.restart});

            connection.subscribeTo('agent-customer-event', function(e) {
                agent.log.info(e, "Received our custom event after a round trip through the dispatcher");
            }, {force: command.payload.restart});
        });

        // Repeat these for testing
        setInterval(function() {

            // Execute a command and expect a response from dispatcher
            connection.execute("my-command", {param1:'value', params2:[1, 2, 3]}).then(function(result) {
                agent.log.info(result, "TEST: Successfully received a response from command my-command");
            }, function(err) {
                agent.log.error(err, "Unable to execute my-command");
            });

            // We broadcast our own custom event
            connection.broadcast("agent-customer-event", {data:'payload-from-agent'});

            // Broadcast only to a specific channel
            connection.broadcast("system-event", {data:'system-related-data'}, {
                channels:['system']
            });

        }, 18000);

    }, function(err) {
        agent.log.error(err, "Unable to establish connection");
    });

    function switchServer(command, deferredResult) {
        deferredResult.resolve({});
    }

    function multimeter(command, deferredResult) {
        _.delay(function(){
            deferredResult.resolve({
                voltage: 120.9,
                current: 8.90,
                idiff: 0.345,
                ts: moment().utc().unix()
            });
        }, 3500);
    }

})();
