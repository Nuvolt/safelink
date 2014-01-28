
module.exports = (function() {

    function Transport(log) {
        this.log = log;
    }

    Transport.prototype.isAvailable = function() {
        return false;
    };

    Transport.prototype.send = function(uuid, key, payload, options) {

    };

    return Transport;
})();
