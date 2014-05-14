module.exports = function(grunt) {

    grunt.initConfig({
        pkg: grunt.file.readJSON('package.json'),
        uglify: {
            options: {
                banner: [
                    '/*! ',
                    ' <%= pkg.name %> - v<%= pkg.version %> - <%= grunt.template.today("yyyy-mm-dd") %>',
                    '(C) 2014 Joel Grenon. Distributed under the Apache Version 2.0, January 2004. See attached license',
                    '*/'
                ].join('\n'),
                compress: {
                    drop_console: true
                },
                mangle: true
            },
            all: {
                files: [{
                    expand: true,
                    cwd: '.',
                    src: ['lib/**/*.js', './index.js'],
                    dest: 'dist'
                }]
            },
            agent: {
                files: [{
                    expand: true,
                    cwd: '.',
                    src: ['lib/**/*.js', '!lib/dispatcher.js', '!lib/protocol/**', '!lib/watchdog.js', './main.js'],
                    dest: 'dist/agent'
                }]
            }
        },
        jshint: {
            files: ['./index.js', 'lib/**/*.js'],
            options: {
                jshintrc: true
            }
        },
        clean: {
            build: {
                src: ["./dist"]
            }
        },
        copy: {
            doc:{
                expand: true,
                cwd: './docs',
                src: ['**/*.*'],
                dest: './dist/doc'
            },
            agent_doc:{
                expand: true,
                cwd: './docs',
                src: ['**/*.*'],
                dest: './dist/agent/doc'
            },
            support_files: {
                src: ['./package.json', './readme.md', './LICENSE-2.0.txt', './lib/status_report.hbs'],
                dest: './dist/'
            },
            agent_support_files: {
                files:[{
                    src:['./package-agent.json', './readme.md', './LICENSE-2.0.txt'],
                    dest: './dist/agent/',
                    cwd: '.',
                    expand: true,
                    rename: function(dest, src) {
                        console.log(src);
                        if(src === './package-agent.json')
                            return dest + "package.json";
                        else
                            return dest + src;
                    }
                }]
            }
        }
    });

    grunt.loadNpmTasks('grunt-contrib-uglify');
    grunt.loadNpmTasks('grunt-contrib-jshint');
    grunt.loadNpmTasks('grunt-contrib-clean');
    grunt.loadNpmTasks('grunt-contrib-copy');

    grunt.registerTask('default', ['clean:build', 'jshint', 'uglify:all', 'copy:doc', 'copy:support_files' ]);
    grunt.registerTask('agent', ['clean:build', 'jshint', 'uglify:agent', 'copy:agent_doc', 'copy:agent_support_files']);
};
