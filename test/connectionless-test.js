require('js-yaml');

var Agent = require('../index').Agent,
    config = require('./connectionless.yml'),
    Dispatcher = require('../index').Dispatcher;


var dispatcher = new Dispatcher(config.dispatcher);

dispatcher.listen().then(function() {
    dispatcher.log.info("Test Dispatcher Running on port %d...", dispatcher.port);
    dispatcher.log.info("Starting agent...");

    var agent = new Agent(config.agent);

    agent.start(function(agent) {
        console.log("Agent started");

        agent.on('configure', function(context) {
            console.log("Configure called with context", context);
        });
    });
});

