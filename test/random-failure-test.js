require('js-yaml');

var Agent = require('../index').Agent,
    config = require('./random-failures.yml'),
    HttpProxy = require('http-proxy'),
    _ = require('lodash'),
    heapdump = require('heapdump'),
    Dispatcher = require('../index').Dispatcher;

var dispatcher = new Dispatcher(config.dispatcher);

var agents = {};

dispatcher.listen().then(function() {
    dispatcher.log.info("Test Dispatcher Running on port %d...", dispatcher.port);

    // Do we have a proxy in our scenario?
    if(config.proxy) {

    }

    // Creating all test agents
    for(var i=0; i<config.scenario.agent_count; i++) {
        var agent = new Agent(config.agent_spec);
        agents[agent.id] = agent;
        agent.start().then(onAgentStarted, onAgentFailure);
    }

    function onAgentStarted(agent) {
        agent.log.debug("Agent %s was successfully started", agent.id);
    }

    function onAgentFailure(err) {
        console.log("Unable to start agent", err);
    }

    // Start the failure behavior
    var randomFailures = new RandomFailures(config.scenario.failures);

    // Start the command execution behavior
    var eventEmitter = new RandomEvent(config.scenario.events);

    // Start the event sending behavior
    var commandSender = new RandomCommand(config.scenario.commands);

    setTimeout(function(){
        randomFailures.stop();
        eventEmitter.stop();
        commandSender.stop();

        // Stop all agents
        _.each(_.values(agents), function(agent){
            agent.log.info("Terminating agent %s", agent.id);
            agent.stop();
        });

        heapdump.writeSnapshot();
        console.log("Test Scenario successfully completed");

    }, config.scenario.duration * 1000);

    heapdump.writeSnapshot();
});


var RandomEvent = function(spec) {
    var _this = this;

    var loop = setInterval(function() {

    }, 2000);

    this.stop = function() {
        clearInterval(loop);
    };
};

var RandomFailures = function(spec) {
    var _this = this;

    var loop = setInterval(function() {

        // Determining agent failures
        if(spec.agent_failure_threshold){
            _.each(_.values(agents), function(agent) {

                if(!agent.suspended) {
                    var rnd = Math.random();
                    if(rnd <= spec.agent_failure_threshold) {
                        var duration = parseInt( (Math.random() * (spec.max_failure_duration-spec.min_failure_duration) + spec.min_failure_duration).toFixed(0));
                        agent.log.warn("Simulating a failure of %d seconds for agent %s", duration, agent.id, {random:rnd, threshold:spec.agent_failure_threshold});
                        agent.suspend(duration);
                    }
                }

            });
        }

        // Check for dispatcher failure
        if(spec.dispatcher_failure_threshold) {
            if(Math.random() <= spec.dispatcher_failure_threshold && !dispatcher.suspended) {
                var duration = parseInt( (Math.random() * (spec.max_failure_duration-spec.min_failure_duration) + spec.min_failure_duration).toFixed(0));
                dispatcher.log.warn("Simulating a dispatcher failure of %d seconds", duration);
                dispatcher.suspend(duration);
            }
        }

        // Check for network failures
        if(spec.network_failure_threshold) {

        }

    }, 2000);

    this.stop = function() {
        clearInterval(loop);
    };
};

var RandomCommand = function(spec) {
    var _this = this;

    var loop = setInterval(function() {

    }, 2000);

    this.stop = function() {
        clearInterval(loop);
    };
};
