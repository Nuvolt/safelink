var express = require('express'),
    http = require('http'),
    socketio = require('socket.io'),
    Agent = require('../../..').Agent,
    path = require('path'),
    Q = require('q');

module.exports.launch = function(opts) {
    opts = opts || {};
    console.log("Launching the web server");

    // Start the server agent
    var agent = new Agent({
        id:'server-agent',
        endpoint: 'http://localhost:9090',
        logLevel: 'trace'
    });
    agent.start().then(function(){
        console.log("server-agent was successfully started");
    });

    var app = express();
    var server = http.createServer(app);
    var io = socketio.listen(server);

    app.set('title', 'Safelink Examples: Long-Progress');
    app.set('port', opts.port || 5555);
    app.set('views', path.resolve(__dirname, "../web/views"));
    app.set('view engine', 'jade');
    app.use(express.bodyParser());
    app.use(express.cookieParser('smartscan-232328912!@@!#@!'));
    app.use(app.router);
    app.use(express.static(path.resolve(__dirname, "../web/public")));

    app.get('/', function(req, res) {
        res.render('index', {title: app.get('title')});
    });

    // Manage client connections
    io.sockets.on('connection', function(socket) {

        socket.on('start-task', function() {
            agent.log.info("Starting long task");
            agent.executeOn('long-process-executer', 'start-long-task', {}, {timeout:220}).then(function(result) {
                agent.log.info("Received task result", result);
                if(result.success)
                    socket.emit('task-complete', result);
                else
                    socket.emit('task-error', err);
            }, function(err) {
                agent.log.error("Task error:",err);
                socket.emit('task-error', err);
            }, function(progress) {
                agent.log.debug("Task progress", progress);
                socket.emit('task-progress', progress);
            });

        });

        socket.on('stop-task', function() {
            agent.log.info("Stopping long task");

            agent.executeOn('long-process-executer', 'stop-long-task').then(function(result) {
                agent.log.info("Task was stopped");
                socket.emit('task-stopped', result);
            }, function(err) {
                agent.log.error("Stop Task error", err);
                socket.emit('task-error', err);
            });

        });

    });

    return Q.ninvoke(server, "listen", app.get('port')).then(function(){
        console.log("Web server is now started at port", app.get('port'));
    });
};
