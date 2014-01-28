var Dispatcher = require('./lib/dispatcher'),
    WebServer = require('./lib/server'),
    Agent = require('./lib/agent'),
    Q = require('q'),
    spawn = require('child_process').spawn;

console.log("Starting all sample app components");

Dispatcher.launch().then(function(){
    console.log("Dispatcher was successfully started");

    return Q.all([
        Agent.launch(),
        WebServer.launch()
    ]);
}).then(function() {
    console.log("Long-Progress sample is now launched");
    spawn('open', ['http://localhost:5555']);
});
