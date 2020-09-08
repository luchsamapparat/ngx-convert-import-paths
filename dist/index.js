#!/usr/bin/env node
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.run = void 0;
const chalk_1 = require("chalk");
const fs_1 = require("fs");
const lodash_1 = require("lodash");
const path = __importStar(require("path"));
const pretty_1 = __importDefault(require("pretty"));
const ts_morph_1 = require("ts-morph");
const yargs_1 = __importDefault(require("yargs"));
const options = yargs_1.default
    .option('workspacePath', {
    type: 'string',
    alias: 'p',
    demandOption: true
})
    .argv;
verifyWorkspacePathExists(options.workspacePath);
run(options.workspacePath);
async function run(workspacePath) {
    const tsProject = getTsProject(workspacePath);
    const workspace = await getAngularWorkspace(workspacePath);
    getProjects(workspace)
        .map(project => getTsConfigPathForProject(workspacePath, project))
        .filter(tsConfigPath => fs_1.existsSync(tsConfigPath))
        .forEach(tsConfigPath => tsProject.addSourceFilesFromTsConfig(tsConfigPath));
    console.log(chalk_1.cyan(`${chalk_1.white(tsProject.getSourceFiles().length)} source files found in workspace.`));
    const components = tsProject.getSourceFiles()
        .flatMap(sourceFile => sourceFile.getClasses())
        .filter(isComponent);
    console.log(chalk_1.cyan(`${chalk_1.white(components.length)} components found in workspace.`));
    components.forEach(component => extractTemplateToFile(component));
    console.log(chalk_1.green(`Template extraction completed.`));
}
exports.run = run;
var ProjectType;
(function (ProjectType) {
    ProjectType["Application"] = "application";
    ProjectType["Library"] = "library";
})(ProjectType || (ProjectType = {}));
function verifyWorkspacePathExists(workspacePath) {
    const absoluteWorkspacePath = path.join(process.cwd(), workspacePath);
    if (!fs_1.existsSync(absoluteWorkspacePath)) {
        console.error(chalk_1.red(`Workspace path ${workspacePath} does not exist.`));
        process.exit(-1);
    }
}
async function extractTemplateToFile(componentClass) {
    const template = getTemplate(componentClass);
    const componentFileName = componentClass.getSourceFile().getFilePath();
    if (lodash_1.isUndefined(template)) {
        console.log(chalk_1.grey(`Skipping ${componentFileName}. No inline-template found.`));
        return;
    }
    console.log(`Extracting inline-template from ${chalk_1.yellow(componentFileName)}.`);
    const templatePath = getTemplatePathForComponent(componentClass);
    await writeTemplateFile(templatePath, template);
    replaceTemplateInMetadataWithPath(componentClass, templatePath);
    return await saveChanges(componentClass);
}
async function saveChanges(componentClass) {
    const componentFile = componentClass.getSourceFile();
    componentFile.formatText();
    return await componentFile.save();
}
function replaceTemplateInMetadataWithPath(componentClass, templatePath) {
    var _a;
    const componentMetadata = getComponentMetadata(componentClass);
    if (lodash_1.isUndefined(componentMetadata)) {
        return;
    }
    (_a = componentMetadata.getProperty('template')) === null || _a === void 0 ? void 0 : _a.remove();
    componentMetadata.addPropertyAssignment({
        name: 'templateUrl',
        initializer: `'./${path.basename(templatePath)}'`
    });
}
async function writeTemplateFile(templatePath, template) {
    return await fs_1.promises.writeFile(templatePath, pretty_1.default(template, { ocd: true }));
}
function getTemplatePathForComponent(componentClass) {
    return componentClass.getSourceFile().getFilePath().replace(/\.ts$/, '.html');
}
function getTemplate(componentClass) {
    const componentMetadata = getComponentMetadata(componentClass);
    if (lodash_1.isUndefined(componentMetadata)) {
        return undefined;
    }
    const templateProperty = componentMetadata.getProperty('template');
    if (lodash_1.isUndefined(templateProperty)) {
        return undefined;
    }
    try {
        return templateProperty.getInitializer().getLiteralValue();
    }
    catch (error) {
        console.error(chalk_1.red(`Cannot read template of ${componentClass.getSourceFile().getFilePath()}`));
        console.error(chalk_1.red(error));
        return undefined;
    }
}
function getComponentMetadata(componentClass) {
    const componentDecorator = getComponentDecorator(componentClass);
    if (lodash_1.isUndefined(componentDecorator)) {
        return undefined;
    }
    return componentDecorator.getArguments()[0];
}
function isComponent(cls) {
    return !lodash_1.isUndefined(getComponentDecorator(cls));
}
function getComponentDecorator(cls) {
    return cls.getDecorators().find(isComponentDecorator);
}
function isComponentDecorator(decorator) {
    if (decorator.getName() !== 'Component') {
        return false;
    }
    return hasComponentDecoratorImport(decorator.getSourceFile());
}
function hasComponentDecoratorImport(sourceFile) {
    return !lodash_1.isUndefined(sourceFile.getImportDeclaration(isComponentDecoratorImport));
}
function isComponentDecoratorImport(importDeclaration) {
    if (importDeclaration.getModuleSpecifier().getLiteralValue() !== '@angular/core') {
        return false;
    }
    return importDeclaration.getNamedImports()
        .some(namedImport => namedImport.getName() === 'Component');
}
async function readWorkspace(path) {
    return JSON.parse(await fs_1.promises.readFile(path, 'utf-8'));
}
function getProjects(workspace) {
    return lodash_1.map(workspace.projects, (project, name) => ({
        name,
        ...project
    }));
}
function getTsConfigPathForProject(workspacePath, { projectType, root }) {
    const fileNameMapping = {
        [ProjectType.Application]: 'tsconfig.app.json',
        [ProjectType.Library]: 'tsconfig.lib.json'
    };
    return path.join(workspacePath, root, fileNameMapping[projectType]);
}
function getTsProject(workspacePath) {
    const tsConfigFilePath = getRootTsConfigPath(workspacePath);
    const absoluteTsConfigFilePath = path.join(process.cwd(), tsConfigFilePath);
    console.log(chalk_1.cyan(`Reading tsconfig from ${chalk_1.white(absoluteTsConfigFilePath)}.`));
    return new ts_morph_1.Project({ tsConfigFilePath });
}
function getRootTsConfigPath(workspacePath) {
    const tsConfigFileNames = ['tsconfig.json', 'tsconfig.base.json'];
    const tsConfigFileName = tsConfigFileNames
        .find(fileName => fs_1.existsSync(path.join(process.cwd(), workspacePath, fileName)));
    if (lodash_1.isUndefined(tsConfigFileName)) {
        console.error(chalk_1.red(`No tsconfig file found in workspace directory:`));
        tsConfigFileNames
            .map(fileName => path.join(workspacePath, fileName))
            .forEach(filePath => console.error(chalk_1.red(`  ${filePath}`)));
        process.exit(-1);
    }
    return path.join(workspacePath, tsConfigFileName);
}
async function getAngularWorkspace(workspacePath) {
    const angularJsonPath = path.join(workspacePath, 'angular.json');
    const absoluteAngularJsonPath = path.join(process.cwd(), angularJsonPath);
    console.log(chalk_1.cyan(`Reading angular.json from ${chalk_1.white(absoluteAngularJsonPath)}.`));
    return await readWorkspace(angularJsonPath);
}
