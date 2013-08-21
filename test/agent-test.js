(function(){

    var Agent = require("../index").Agent,
        _ = require('underscore'),
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
            payload: function() {
                return {
                    gateways:{
                        101:{
                            500: "test",
                            501: "test2"
                        }
                    }
                }
            }
        },
        endpoint:"http://localhost:9090/agent",
        log: log.child({level:'info'}),
        commandHandlers:{
            "switch-server": switchServer,
            'multimeter': multimeter
        },
        eventHandlers:{}
    });

    agent.connect().then(function(connection) {

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

        connection.subscribeTo('custom', function(data) {
            agent.log.info(data, "Received custom event with attached data");
        });


    }, function(err) {
        agent.log.error(err, "Unable to establish connection");
    });

    function switchServer(command, deferredResult){
        deferredResult.resolve({});
    }

    function multimeter(command, deferredResult){
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
