(function(){'use strict';

    $(function() {

        var $stop = $("#stopTask");
        var $start = $("#startTask");
        var $progress = $('#taskProgress > .progress-bar');
        var $report = $('#report');

        var socket = io.connect('http://localhost:5555/');

        socket.on('task-complete', function(result){
            console.log("task complete", result);
        });

        socket.on('task-error', function(err) {
            console.log("task error", err);
        });

        socket.on('task-progress', function(progress) {
            reportProgress(progress.value, progress.msg);
        });

        socket.on('task-stopped', function(result){
            console.log("Task stopped", result);
        });

        $start.click(function() {
            $start.toggleClass('hidden');
            $stop.toggleClass('hidden');
            socket.emit('start-task');
            reportProgress(1, "Task has been started");
        });

        $stop.click(function() {
            $start.toggleClass('hidden');
            $stop.toggleClass('hidden');
            socket.emit('stop-task');
        });

        function reportProgress(value, msg) {

            $progress.css('width', value+'%');
            $report.append("<li> 12:00AM - "+ msg+"</li>");
        }

    });

})();
