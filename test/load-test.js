require('js-yaml');

var Agent = require('../index').Agent,
    config = require('./load-test.yml'),
    Dispatcher = require('../index').Dispatcher;


var dispatcher = new Dispatcher(config.dispatcher);

var sender = new Agent(config.sender);

var receiver = new Agent(config.receiver);

var interval;

dispatcher.listen().then(function() {
    dispatcher.log.info("Test Dispatcher Running on port %d...", dispatcher.port);
    dispatcher.log.info("Connecting both sender and receiver");
    sender.connect().then(function(sender){
        sender.log.info("Sender is connected");

        sender.on('configure', function(command) {
            sender.log.info ("Configuring our event handlers");

            // Register our agent to receive command progress events
            sender.subscribeTo('command-progress', function(progress) {
                sender.log.info("Received progress: ", progress);
            },{force: command.payload.restart});

            // Launch our command execution loop.
            if(!interval) {
                interval = setInterval(function() {
                    sender.executeOn('receiver', "ping-pong", {ping:true}).then(function(result) {
                        sender.log.info("Received result:", result);
                    }, function(err) {
                        sender.log.error("Unable to execute ping-pong",err);
                    });
                }, config.send_interval);
            }

        });

    });

    receiver.connect().then(function() {
        receiver.log.info("Sender is connected");

        receiver.registerCommandHandler('ping-pong', function(command, deferredResult) {
            setTimeout(function(){
                receiver.log.info("Sending back pong response for command %s", command.id);

                // Send progress notification
                deferredResult.notify({progress: 1});

                // Send the final response
                setTimeout(function(){
                    deferredResult.resolve({pong:true});
                }, 3500);
            }, 0);
        });
    });

});

