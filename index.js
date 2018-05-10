#!/usr/bin/env node --harmony
var co = require('co');
var prompt = require('co-prompt');
var program = require('commander');
var cmd = require('node-cmd');
const { exec } = require('child_process');
var apkDirectory = '';
var maxMutants = 0;
var results = {
    goodMonkeys : 0,
    badMonkeys : 0,
    monkeyResults: [],
    mutantDescriptions : []
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
    `, function(err, data, stderr) {
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
                    ./gradlew assembleDebug
                `, function(err, data, stderr) {
                    if (!err) {
                        // console.log(data);
                        cmd.get(`
                            cd ${androidStudioPath}
                            cd ../
                            cd ./${x}/app/build/outputs/apk/debug
                            mv app-debug.apk ${mdroidFolder}/output/apks/
                            cd ${mdroidFolder}/output/apks/
                            mv "app-debug.apk" "app-mutant-${x}.apk"
                            cd ${androidStudioPath}
                            cd ../
                            rm -rf ${x}
                        `, function(err, data, stderr) {
                            if(!err) {
                                if (x == numOfMutants - 1) {
                                    runMonkeys(0)
                                    restoreOriginalContent();
                                }
                            } else {
                                console.log('error', err);
                                restoreOriginalContent();
                            }
                        });
                    } else {
                        console.log('error', err);
                        restoreOriginalContent();
                    }
                })
            }
        } else {
            console.log('error', err);
            restoreOriginalContent();
        }
    })
}

function runMonkeys(x) {
    console.log(`\n\nRunning monkey ${x}`);
        cmd.get(`
            cd ${mdroidFolder}/output/apks/
            emulator @Nexus5 -gpu on
            adb install -r app-mutant-${x}.apk
            adb shell monkey -p ${packageName} -s ${x}919 -v -v 100
        `, function(err, data, stderr) {
            if(!err) {
                results.goodMonkeys++
                results.monkeyResults[x] = 'PASSED';
            } else {
                console.log('\nMico malo !!\n', err);
                results.badMonkeys++;
                results.monkeyResults[x] = `FAILED`;
            }
            if (x < numOfMutants - 1) {
                runFirebaseTestLab(x);
                runMonkeys(x + 1);
            } else {
                console.log('=============================\n');
                console.log('Resultados:');
                console.log('Monkey tests passed: ' + results.goodMonkeys);
                console.log('Monkey tests failed: ' + results.badMonkeys);
                for (var i = 0; i < numOfMutants; i++) {
                    console.log(`Mutant ${i+1}: ${results.mutantDescriptions[i]}\t(${results.monkeyResults[i]})`);
                }
                console.log('\n=============================');
            }
        });
}

function runFirebaseTestLab(x) {
    console.log('\n\nRunning Firebase Test Lab');
    cmd.get(`
        cd ${mdroidFolder}/output/apks/
        gcloud firebase test android run --app app-mutant-${x}.apk --device model=Nexus6,version=21,locale=en,orientation=portrait --timeout 90s
    `, function (err, data, stderr) {
        if(!err) {
            console.log(data);
        } else {
            console.log(`Error\n\n: ${stderr}`);
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