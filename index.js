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
var results = {
    goodMonkeys : 0,
    badMonkeys : 0,
    monkeyResults: [],
    mutantDescriptions : [],
    unitResults : [],
    firebaseTestResults : []
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
            console.log('Number of mutants raised:', lines[0]);
            maxMutants = lines[0];
            if (numOfMutants > maxMutants) numOfMutants = maxMutants;
            for (var i = 1; i <= numOfMutants; i++) {
                let string = `Mutant: ${i} - `;
                let mutant = x.split(string)[1];
                let mutantDesc = mutant.split('\n')[0];
                results.mutantDescriptions.push(mutantDesc);
            }
            backupOriginalProject();
        } else {
            console.log('error', err);
        }
    });
}

function backupOriginalProject() {
    console.log('\nCreating original proyect Backup...\n');
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

function restoreOriginalContent() {
    console.log('\nRestoring original proyect Backup...');
    cmd.get(`
        cd ${mdroidFolder}
        mv backup/original/main/ ${androidStudioPath}app/src/
    `, function(err, data, stderr) {
        if (!err) {
            console.log('Original content restored...\n');
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
    `, function(err, data, stderr2) {
        if (!err) {
            apkDirectory = data;
            for (var i = 0; i < numOfMutants; i++) {
                let x = i;
                randomMutant = Math.floor(Math.random() * maxMutants) + 1;
                cmd.get(`
                    cd ${androidStudioPath}
                    cd ../
                    rm -rf ${x}
                    mkdir ${x}
                    cp -a ${androidStudioPath} ${x}
                    cp -a ${mdroidFolder}/${mutantsPath}/${appName}-mutant${randomMutant}/ ${x}/app/src/main
                    cd ${x}
                    chmod +x gradlew
                    ./gradlew test
                `, function(err1, data1, stderr1) {
                    if(err1) {
                        console.log('errooooooooor', err1);
                        results.unitResults[x] = false
                        // restoreOriginalContent();
                    } else {
                        console.log(data1);
                        results.unitResults[x] = true
                    }
                    cmd.get(`
                        cd ${androidStudioPath}
                        cd ../
                        cd ${x}
                        ./gradlew assembleDebug
                    `, function(err2, data2, stderr2) {
                        if (!err2) {
                            // console.log(data);
                            // rm -rf ${x}
                            cmd.get(`
                                cd ${androidStudioPath}
                                cd ../
                                cd ./${x}/app/build/outputs/apk/debug
                                mv app-debug.apk ${mdroidFolder}/output/apks/
                                cd ${mdroidFolder}/output/apks/
                                mv "app-debug.apk" "app-mutant-${x}.apk"
                                cd ${androidStudioPath}
                                cd ../                                    
                            `, function(err3, data3, stderr3) {
                                if(!err3) {
                                    if (x == numOfMutants - 1) {
                                        setTimeout(function () {
                                            runMonkeys(0);
                                        }, 5000);
                                        restoreOriginalContent();
                                    }
                                } else {
                                    console.log('error', err3);
                                    restoreOriginalContent();
                                }
                            });
                        } else {
                            console.log('error', err2);
                            restoreOriginalContent();
                        }
                    })
                })
            }
        } else {
            console.log('error', err);
            restoreOriginalContent();
        }
    })
}

function startEmulator() {
    cmd.run('cd ${ANDROID_HOME}/tools && ./emulator @Nexus5');
}

function runMonkeys(x) {
    console.log(`\n\nRunning monkey ${x}`);
        cmd.get(`
            cd ${mdroidFolder}/output/apks/
            adb install -r app-mutant-${x}.apk
            adb shell monkey -p ${packageName} -s ${x}919 -v -v ${numOfMonkeyEvents}
        `, function(err, data, stderr) {
            if(!err) {
                results.goodMonkeys++
                results.monkeyResults[x] = true;
            } else {
                console.log('\nMico malo !!\n', err);
                results.badMonkeys++;
                results.monkeyResults[x] = false;
            }
            if (firebaseTestLab) {
                runFirebaseTestLab(x);
            }
            if (x < numOfMutants - 1) {
                runMonkeys(x + 1);
            } else {
                if (!firebaseTestLab) {
                    generateResults();
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
            results.firebaseTestResults[i] = data.includes('Passed');
        } else {
            console.log(`Error\n\n: ${stderr}`);
            results.firebaseTestResults[x] = false;
        }
        if(firebaseCounter == numOfMutants) {
            generateResults();
        }
    });
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
    var ref = firebase.database().ref('tests/').push();
    ref.set(testResult);
    console.log('\n=============================');
    console.log(`Visita https://hitpa.tresastronautas.com para ver el resultado de tu prueba al detalle (ID = ${ref})`);
    console.log('=============================');
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