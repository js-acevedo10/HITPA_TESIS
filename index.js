#!/usr/bin/env node --harmony
var co = require('co');
var prompt = require('co-prompt');
var program = require('commander');
var cmd = require('node-cmd');
const { exec } = require('child_process');
var apkDirectory = '';
var maxMutants = 0;

function installMDroid() {
    console.log('Installing mDroid+ and its dependencies...');
    exec('cd ' + mdroidFolder + ' mvn clean && mvn package', (err, stdout, stderr) => {
        console.log(stdout);
        console.log(stderr);
        if(err) {
            console.log('Error installing mDroid+ and its dependencies, please make sure you have Maven installed.');
        } else {
            runMDroid();
        }
    })
}

function runMDroid() {
    console.log('Running mDroid+...');
    console.log(`java -jar target/MDroidPlus-1.0.0.jar libs4last/ ${androidStudioPath}app/src/main ${appName} ${mutantsPath} . true`);
    cmd.get(`
        cd ${mdroidFolder}
        rm -rf ${mutantsPath}
        mkdir -p ${mutantsPath}
        java -jar target/MDroidPlus-1.0.0.jar libs4last/ ${androidStudioPath}app/src/main ${appName} ${mutantsPath} . true
    `, function(err, data, stderr) {
        if (!err) {
            console.log(data);
            var x = data.split("Total Locations: ")[1];
            var lines = x.split('\n');
            console.log('number of mutants:', lines[0]);
            maxMutants = lines[0];
            backupOriginalProject();
        } else {
            console.log('error', err);
        }
    });
}

function backupOriginalProject() {
    console.log('Creating original proyect Backup...');
    cmd.get(`
        cd ${mdroidFolder}
        rm -rf backup/original/
        mkdir -p backup/original/
        mv ${androidStudioPath}app/src/main backup/original/
    `, function(err, data, stderr) {
        if (!err) {
            createMutants();
        } else {
            console.log('error', err);
        }
    })
}

function createMutants() {
    console.log('Creando .apks de mutantes...')
    cmd.get(`
        cd ${mdroidFolder}
        rm -rf output/apks
        mkdir -p output/apks/
        cd ${androidStudioPath}/app/build/outputs/apk/debug
        pwd
    `, function(err, data, stderr) {
        if (!err) {
            apkDirectory = data;
            if (numOfMutants > maxMutants) numOfMutants = maxMutants;
            // for (var i = 0; i < numOfMutants; i++) {
                var i = 1;
                randomMutant = Math.floor(Math.random() * maxMutants) + 1;
                cmd.get(`
                    cp -a ${mdroidFolder}/${mutantsPath}/${appName}-mutant${randomMutant}/ ${androidStudioPath}app/src/main
                    cd ${androidStudioPath}
                    chmod +x gradlew
                    ./gradlew assembleDebug
                `, function(err, data, stderr) {
                    if (!err) {
                        console.log(data);
                        cmd.get(`
                            cd ${androidStudioPath}/app/build/outputs/apk/debug
                            mv app-debug.apk ${mdroidFolder}/output/apks/
                            cd ${mdroidFolder}/output/apks/
                            mv "app-debug.apk" "app-mutant-${i}.apk"
                        `, function(err, data, stderr) {
                            if(!err) {
                                runMonkeys()
                            } else {
                                console.log('error', err);
                            }
                        });
                    } else {
                        console.log('error', err);
                    }
                })
            // }
        } else {
            console.log('error', err);
        }
    })
}

function runMonkeys() {
    console.log("Running monkeys...");
    cmd.get(`
        cd ${mdroidFolder}/output/apks/
        adb install -r app-mutant-1.apk
        adb shell monkey -p ${packageName} -s 1 -v -v 1000
    `, function(err, data, stderr) {
        if(!err) {
            console.log(data);
        } else {
            console.log('error', err);
        }
    });
}

program
    .version('0.0.1')
    .arguments('<android_studio_path> <package_name> <app_name> <mdroid-folder> [num_of_mutants]')
    .action(function(android_studio_path, package_name, app_name, mdroid_folder, num_of_mutants) {
        co(function *() {
            androidStudioPath = android_studio_path.replace(/ /g,"\\ ");
            packageName = package_name.replace(/ /g,"\\ ");
            appName = app_name.replace(/ /g,"\\ ");
            mdroidFolder = mdroid_folder.replace(/ /g,"\\ ");
            mutantsPath = 'tmp/mutants/';
            if (num_of_mutants !== undefined) {
                numOfMutants = num_of_mutants;
            } else {
                numOfMutants = 5;
                console.log('5 mutantes');
            }
        })
    });
program.parse(process.argv);

if (typeof androidStudioPath === 'undefined') {
    console.error('Android Studio Path not recognized.');
    process.exit(1);
}

if (typeof appName === 'undefined') {
    console.error('App Name not recognized.');
    process.exit(1);
}

if (typeof packageName === 'undefined') {
    console.error('Package Name not recognized.');
    process.exit(1);
}

if (typeof mdroidFolder === 'undefined') {
    console.error('mDroid Folder not recognized.');
    process.exit(1);
}

installMDroid();