var Dispatcher = require('../../..').Dispatcher;

var dispatcher;

module.exports.launch = function(opts) {
    opts = opts || {};

    dispatcher = new Dispatcher({
        port:9090,
        wss:{
            port:9091
        },
        logLevel: 'debug'
    });

    return dispatcher.listen();
};
