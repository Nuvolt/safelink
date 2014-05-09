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
            safelink: {
                files: [{
                    expand: true,
                    cwd: '.',
                    src: ['lib/**/*.js', './index.js'],
                    dest: 'dist'
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
            support_files: {
                src: ['./package.json', './readme.md', './LICENSE-2.0.txt'],
                dest: './dist/'
            }
        }
    });

    grunt.loadNpmTasks('grunt-contrib-uglify');
    grunt.loadNpmTasks('grunt-contrib-jshint');
    grunt.loadNpmTasks('grunt-contrib-clean');
    grunt.loadNpmTasks('grunt-contrib-copy');
    grunt.registerTask('default', ['clean:build', 'jshint', 'uglify:safelink', 'copy:doc', 'copy:support_files' ]);
};
