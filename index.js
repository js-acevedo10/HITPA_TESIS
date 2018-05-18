#!/usr/bin/env node --harmony
var co = require('co');
var prompt = require('co-prompt');
var program = require('commander');
var cmd = require('node-cmd');
var propertiesReader = require('properties-reader');
var firebase = require('firebase');
require('@firebase/database');
const { exec } = require('child_process');
var apkDirectory = '';
var maxMutants = 0;
var firebaseCounter = 0;
var initTime = Date();
var firebaseTestKey = '';
let descriptions = [];
var results = {
    monkeyResults: [],
    monkeyTraces: [],
    mutantDescriptions : [],
    unitResults : [],
    unitTraces: [],
    firebaseTestResults : [],
    firebaseTraces: [],
    monkeySeeds: [],
    compilationResults: [],
    compilationTraces: [],
    pending : false,
}

function Stack() {
    this.data = [];
    this.top = 0;
}

Stack.prototype.pop = function () {
    return this.data[--this.top];
};

Stack.prototype.peek = function () {
    return this.data[this.top - 1];
};

Stack.prototype.length = function () {
    return this.top;
};

Stack.prototype.clear = function () {
    this.top = 0;
};

function installMDroid() {
    console.log('Installing mDroid+ and its dependencies...');
    exec('cd ' + mdroidFolder + ' mvn clean && mvn package', (err, stdout, stderr) => {
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
    const mdroidRef = cmd.get(`
        cd ${mdroidFolder}
        rm -rf ${mutantsPath}
        mkdir -p ${mutantsPath}
        java -jar target/MDroidPlus-1.0.0.jar libs4last/ ${androidStudioPath}app/src/main ${appName} ${mutantsPath} . true
    `);
    let data_line = '';
    let data_error_line = '';
    let error_line = '';

    mdroidRef.stderr.on('data', function(data) {
        if (error_line != data) {
            error_line += data;
        }
    });

    mdroidRef.stderr.on('end', function() {
        console.log(error_line);
    });
    
    mdroidRef.stdout.on('data', function(data) {
        data_line += data;
    });

    mdroidRef.stdout.on('error', function(error) {
        data_error_line += error;
    });

    mdroidRef.stdout.on('end', function() {
        console.log(data_line);
        if (!error_line.includes('(No such file or directory)')) {
            var x = data_line.split("Total Locations: ")[1];
            var lines = x.split('\n');
            maxMutants = lines[0];
            if (numOfMutants > maxMutants) numOfMutants = maxMutants;
            for (var i = 1; i <= maxMutants; i++) {
                let string = `Mutant: ${i} - `;
                let mutant = x.split(string)[1];
                let mutantDesc = mutant.split('\n')[0];
                descriptions.push(mutantDesc);
            }
            console.log(descriptions);
            backupOriginalProject();
        } else {
            console.log(error_line);
        }
    });
}

function backupOriginalProject() {
    console.log('Creando copia de seguridad del proyecto original.')
    cmd.get(`
        cd ${mdroidFolder}
        rm -rf backup/original/
        mkdir -p backup/original/
        mv ${androidStudioPath}app/src/main backup/original/
    `, function(err, data, stderr) {
        if (!err) {
            runUnitTest();
        } else {
            console.log('error', err);
        }
    })
}

function restoreOriginalContent() {
    cmd.get(`
        cd ${mdroidFolder}
        mv backup/original/main/ ${androidStudioPath}app/src/
    `, function(err, data, stderr) {
        if (!err) {
            console.log('Copia de seguridad del proyecto original restaurada.\n');
        } else {
            console.log('error', err);
        }
    })
}

function runUnitTest() {
    console.log('Corriendo pruebas de unidad sobre los mutantes.');
    cmd.get(`
        cd ${mdroidFolder}
        rm -rf output/apks
        mkdir -p output/apks/
        cd ${androidStudioPath}/app/build/outputs/apk/debug
        pwd
    `, function(err, data, stderr2) {
        if (!err) {
            apkDirectory = data;
            for (var i = 0; i < numOfMutants; i++) {
                let x = i;
                let randomTries = 0;
                randomMutant = Math.floor(Math.random() * maxMutants) + 1;
                while (results.mutantDescriptions.includes(descriptions[randomMutant + 1]) && randomTries < maxMutants - 1) {
                    randomTries++;
                    randomMutant = Math.floor(Math.random() * maxMutants) + 1;
                }
                results.mutantDescriptions[i] = descriptions[randomMutant - 1];
                let uTestRef = cmd.get(`
                    cd ${androidStudioPath}
                    cd ../
                    rm -rf ${x}
                    mkdir ${x}
                    cp -a ${androidStudioPath} ${x}
                    cp -a ${mdroidFolder}/${mutantsPath}/${appName}-mutant${randomMutant}/ ${x}/app/src/main
                    cd ${x}
                    chmod +x gradlew
                    ./gradlew test --stacktrace
                `);
                let uTestRefData = '';
                let uTestRefDataError = '';
                let uTestRefError = '';

                uTestRef.stderr.on('data', function (data) {
                    uTestRefError += data;
                });

                uTestRef.stdout.on('data', function (data) {
                    uTestRefData += data;
                    console.log(data);
                });

                uTestRef.stdout.on('error', function (error) {
                    uTestRefDataError += error;
                });

                uTestRef.stdout.on('end', function () {
                    if (uTestRefData.includes('BUILD SUCCESSFUL')) {
                        console.log(`Pruebas de unidad sobre el mutante ${x} exitosas.`);
                        results.unitResults[x] = true;
                        results.unitTraces[x] = uTestRefData;
                    } else {
                        console.log(`Pruebas de unidad sobre el mutante ${x} fallidas.`);
                        results.unitResults[x] = false;
                        // results.unitTraces[x] = `${packageName}${uTestRefData.split(':app:testDebugUnitTest')[1]}`;
                        results.unitTraces[x] = uTestRefData;
                    }
                    buildMutantApks(x);
                });
            }
        } else {
            console.log('error', err);
            restoreOriginalContent();
        }
    })
}

function buildMutantApks(x) {
    console.log(`Iniciando compilación del mutante ${x}.`);
    let buildRef = cmd.get(`
        cd ${androidStudioPath}
        cd ../
        cd ${x}
        ./gradlew assembleDebug --stacktrace
    `);
    let buildRefData = '';
    let buildRefDataError = '';
    let buildRefError = '';

    buildRef.stderr.on('data', function (data) {
        buildRefError += data;
    });

    buildRef.stderr.on('complete', function () {
        console.log('Error', buildRefError);
    });

    buildRef.stdout.on('data', function (data) {
        buildRefData += data;
    });

    buildRef.stdout.on('error', function (error) {
        buildRefDataError += error;
    });

    buildRef.stdout.on('end', function () {
        if (buildRefData.includes('BUILD SUCCESSFUL')) {
            console.log(`Compilación del mutante ${x} exitosa.`);
            results.compilationResults[x] = true;
            results.compilationTraces[x] = buildRefData;
            moveApk(x);
        } else {
            console.log(`Compilación del mutante ${x} fallida.`);
            results.compilationResults[x] = false;
            results.compilationTraces[x] = buildRefData;
        }
    });
}

function moveApk(x) {
    cmd.get(`
        cd ${androidStudioPath}
        cd ../
        cd ./${x}/app/build/outputs/apk/debug
        mv app-debug.apk ${mdroidFolder}/output/apks/
        cd ${mdroidFolder}/output/apks/
        mv "app-debug.apk" "app-mutant-${x}.apk"
        cd ${androidStudioPath}
        cd ../                                    
    `, function(err, data, stderr) {
    if(!err) {
        if (x == numOfMutants - 1) {
            startEmulator();
            setTimeout(function () {
                runMonkeys(0);
            }, 5000);
                restoreOriginalContent();
            }
        } else {
            console.log('error', err);
            restoreOriginalContent();
        }
    });
}

function startEmulator() {
    cmd.run('cd ${ANDROID_HOME}/tools && ./emulator @Nexus5');
}

function runMonkeys(x) {
    console.log(`\nCorriendo pruebas Monkey sobre el mutante ${x}`);
    let monkeyRef = cmd.get(`
        cd ${mdroidFolder}/output/apks/
        adb install -r app-mutant-${x}.apk
        adb shell monkey -p ${packageName} -s ${x}919 -v ${numOfMonkeyEvents}
    `);
    let monkeyRefData = '';
    let monkeyRefDataError = '';
    let monkeyRefError = '';

    monkeyRef.stderr.on('data', function (data) {
        monkeyRefError += data;
    });

    monkeyRef.stderr.on('end', function () {
        console.log('Error', monkeyRefData);
    });

    monkeyRef.stdout.on('data', function (data) {
        monkeyRefData += data;
    });

    monkeyRef.stdout.on('error', function (error) {
        monkeyRefDataError += error;
    });

    monkeyRef.stdout.on('close', function () {
        // console.log('Data', monkeyRefData);
        // console.log('DataError', monkeyRefDataError);
        // console.log('Error', monkeyRefError);
        if (monkeyRefData.includes('aborted')) {
            console.log(`Mutante ${x} detectado por pruebas monkey.`);
            results.monkeyResults[x] = false;
            results.monkeyTraces[x] = monkeyRefData;
        } else {
            console.log(`Mutante ${x} no detectado por pruebas monkey.`);
            results.monkeyResults[x] = true;
            results.monkeyTraces[x] = monkeyRefData;
        }
        results.monkeySeeds[x] = `${x}919`;
        if (firebaseTestLab) {
            runFirebaseTestLab(x);
        }
        if (x < numOfMutants - 1) {
            runMonkeys(x + 1);
        } else {
            if (!firebaseTestLab) {
                generateResults();
            } else {
                generateTempResults();
            }
        }
    });
}

function runFirebaseTestLab(x) {
    console.log('\n\nRunning Firebase Test Lab');
    cmd.get(`
        cd ${mdroidFolder}/output/apks/
        gcloud firebase test android run --app app-mutant-${x}.apk --device model=Nexus6,version=21,locale=en,orientation=portrait --timeout ${firebaseTestDuration}
    `, function (err, data, stderr) {
        firebaseCounter++;
        if(!err) {
            console.log(data);
            results.firebaseTestResults[x] = data.includes('Passed');
            results.firebaseTraces[x] = false;
        } else {
            console.log(`Error\n\n: ${stderr}`);
            results.firebaseTestResults[x] = false;
            results.firebaseTraces[x] = stderr;
        }
        if(firebaseCounter == numOfMutants) {
            completeResults()
        }
    });
}

function completeResults() {
    results.pending = false;
    writeTestData(results);
}

function generateTempResults() {
    results.pending = true;
    initFirebase();
}

function generateResults() {
    initFirebase();
    console.log('=============================\n');
    console.log('Results:');
    for (var i = 0; i < numOfMutants; i++) {
        console.log(`Mutant ${i+1}:
        Description: ${results.mutantDescriptions[i]}`);
        var unit = 'FAILED';
        if (results.unitResults[i]) {
            unit = 'PASSED';
        }
        console.log(`\tUnit tests: ${unit}`)
        var monkey = 'FAILED';
        if (results.monkeyResults[i]) {
            monkey = 'PASSED';
        }
        console.log(`\tMonkey test: ${monkey}`)
        if(firebaseTestLab) {
            var fire = 'FAILED';
            if (results.firebaseTestResults[i]) {
                fire = 'PASSED';
            }
            console.log(`\tFirebase Test Lab: ${fire}`)
        }
    }
    console.log('\n=============================');
}

function initFirebase() {
    var config = {
        apiKey: "AIzaSyC7V_YT9u-hKqjB9o_QzfOG9nrvNi4oU5Q",
        authDomain: "hitpa-testing-3a.firebaseapp.com",
        databaseURL: "https://hitpa-testing-3a.firebaseio.com",
        storageBucket: "hitpa-testing-3a.appspot.com",
    };
    firebase.initializeApp(config);
    writeTestData(results);
}

function writeTestData(testResult) {
    testResult.initTimestamp = initTime;
    testResult.finishTimestamp = Date();
    testResult.appName = appName;
    testResult.packageName = packageName;
    testResult.numOfMonkeyEvents = numOfMonkeyEvents;
    testResult.firebaseTestLab = firebaseTestLab;
    testResult.firebaseTestDuration = firebaseTestDuration;
    testResult.numOfMutants = numOfMutants;

    if (firebaseTestKey == null || firebaseTestKey == '') {
        let ref = firebase.database().ref('tests/').push();
        ref.set(testResult);
        firebaseTestKey = ref.key;
    } else {
        let ref = firebase.database().ref(`tests/${firebaseTestKey}/`);
        testResult.finishTimestamp = Date();
        ref.set(testResult);
    }
    console.log(`\n=============================
    Visita https://hitpa.tresastronautas.com/test/${firebaseTestKey} para conocer el resultado de tu prueba.
    =============================`);
}

program
    .version('1.0')
    .arguments('<properties_path>')
    .action(function(properties_path) {
        co(function *() {
            properties = propertiesReader(properties_path);
            androidStudioPath = properties.get('android_studio_path').replace(/ /g,"\\ ");
            packageName = properties.get('package_name').replace(/ /g,"\\ ");
            appName = properties.get('app_name').replace(/ /g,"\\ ");
            mdroidFolder = properties.get('mdroid_folder').replace(/ /g,"\\ ");
            mutantsPath = properties.get('mutants_folder').replace(/ /g,"\\ ");
            numOfMutants = properties.get('num_of_mutants');
            numOfMonkeyEvents = properties.get('num_of_monkey_events');
            firebaseTestLab = properties.get('firebase_test_lab');
            firebaseTestDuration = properties.get('firebase_test_duration');
        });
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

if (numOfMutants > 20) {
    console.error('El máximo de mutantes a probar es 20.');
    numOfMutants == 20;
}

if (numOfMonkeyEvents > 10000) {
    console.error('El máximo de eventos Monkey es de 10000.');
    numOfMutants == 5000;
}

installMDroid();