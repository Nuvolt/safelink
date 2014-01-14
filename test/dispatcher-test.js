(function() {
    var Dispatcher = require('../index').Dispatcher;


    var dispatcher = new Dispatcher({
        port:9090,
        wss:{
            port:9091
        }
    });

    dispatcher.listen().then(function() {
        dispatcher.log.info("Listening for incoming agent connections");

        dispatcher.on('heartbeat-payload', function(payload) {
            dispatcher.log.debug(payload, "TEST: Successfully received a payload");
        });

        setInterval(function() {

            dispatcher.executeOnAgent("a0e8d636-1378-4fd3-acfd-654e591d6893", "multimeter", {
                serialNo: "123",
                line:"L1N",
                hole:'H1'
            }).then(function(result){
                console.log("Received result for command multimeter", result);
            }, function(err) {
                console.log("Error received:", err);
            });

        }, 15000);

        setInterval(function() {
            dispatcher.log.debug("Emitting 'custom' event...");
            dispatcher.emit('custom', {
                field1:true,
                field2:"test"
            });
        }, 5000);

    }, function(err) {
        this.log.error(err);
    });

})();
