#!/usr/bin/env node

import { cyan, green, grey, red, white, yellow } from 'chalk';
import { existsSync, promises as fs } from 'fs';
import { isUndefined, map } from 'lodash';
import * as path from 'path';
import pretty from 'pretty';
import { ClassDeclaration, Decorator, ImportDeclaration, ObjectLiteralExpression, Project as TsProject, PropertyAssignment, SourceFile, StringLiteral } from 'ts-morph';
import yargs from 'yargs';

const options = yargs
    .option('workspacePath', {
        type: 'string',
        alias: 'p',
        demandOption: true
    })
    .argv;

verifyWorkspacePathExists(options.workspacePath);

run(options.workspacePath);

export async function run(workspacePath: string) {
    const tsProject = getTsProject(workspacePath);
    const workspace = await getAngularWorkspace(workspacePath);

    getProjects(workspace)
        .map(project => getTsConfigPathForProject(workspacePath, project))
        .filter(tsConfigPath => existsSync(tsConfigPath))
        .forEach(tsConfigPath => tsProject.addSourceFilesFromTsConfig(tsConfigPath));

    console.log(cyan(`${white(tsProject.getSourceFiles().length)} source files found in workspace.`));

    const components = tsProject.getSourceFiles()
        .flatMap(sourceFile => sourceFile.getClasses())
        .filter(isComponent);

    console.log(cyan(`${white(components.length)} components found in workspace.`));

    components.forEach(component => extractTemplateToFile(component));

    console.log(green(`Template extraction completed.`));
}

interface Workspace {
    projects: {
        [key: string]: ProjectDeclaration
    }
}

interface ProjectDeclaration {
    root: string;
    sourceRoot: string;
    projectType: ProjectType;
}

interface Project extends ProjectDeclaration {
    name: string;
}

enum ProjectType {
    Application = 'application',
    Library = 'library'
}

function verifyWorkspacePathExists(workspacePath: string) {
    const absoluteWorkspacePath = path.join(process.cwd(), workspacePath);

    if (!existsSync(absoluteWorkspacePath)) {
        console.error(red(`Workspace path ${workspacePath} does not exist.`));
        process.exit(-1);
    }
}

async function extractTemplateToFile(componentClass: ClassDeclaration) {
    const template = getTemplate(componentClass);

    const componentFileName = componentClass.getSourceFile().getFilePath();

    if (isUndefined(template)) {
        console.log(grey(`Skipping ${componentFileName}. No inline-template found.`));
        return;
    }

    console.log(`Extracting inline-template from ${yellow(componentFileName)}.`);

    const templatePath = getTemplatePathForComponent(componentClass);

    await writeTemplateFile(templatePath, template);

    replaceTemplateInMetadataWithPath(componentClass, templatePath);

    return await saveChanges(componentClass);
}

async function saveChanges(componentClass: ClassDeclaration) {
    const componentFile = componentClass.getSourceFile();
    componentFile.formatText();
    return await componentFile.save();
}

function replaceTemplateInMetadataWithPath(componentClass: ClassDeclaration, templatePath: string) {
    const componentMetadata = getComponentMetadata(componentClass);

    if (isUndefined(componentMetadata)) {
        return;
    }

    componentMetadata.getProperty('template')?.remove();
    componentMetadata.addPropertyAssignment({
        name: 'templateUrl',
        initializer: `'./${path.basename(templatePath)}'`
    });
}

async function writeTemplateFile(templatePath: string, template: string) {
    return await fs.writeFile(templatePath, pretty(template, { ocd: true }));
}

function getTemplatePathForComponent(componentClass: ClassDeclaration) {
    return componentClass.getSourceFile().getFilePath().replace(/\.ts$/, '.html');
}

function getTemplate(componentClass: ClassDeclaration) {
    const componentMetadata = getComponentMetadata(componentClass);

    if (isUndefined(componentMetadata)) {
        return undefined;
    }

    const templateProperty = componentMetadata.getProperty('template') as PropertyAssignment;

    if (isUndefined(templateProperty)) {
        return undefined;
    }

    try {
        return (templateProperty.getInitializer() as StringLiteral).getLiteralValue();
    } catch (error) {
        console.error(red(`Cannot read template of ${componentClass.getSourceFile().getFilePath()}`));
        console.error(red(error));
        return undefined;
    }
}

function getComponentMetadata(componentClass: ClassDeclaration) {
    const componentDecorator = getComponentDecorator(componentClass);

    if (isUndefined(componentDecorator)) {
        return undefined;
    }

    return componentDecorator.getArguments()[0] as ObjectLiteralExpression;
}

function isComponent(cls: ClassDeclaration) {
    return !isUndefined(getComponentDecorator(cls));
}

function getComponentDecorator(cls: ClassDeclaration) {
    return cls.getDecorators().find(isComponentDecorator);
}

function isComponentDecorator(decorator: Decorator) {
    if (decorator.getName() !== 'Component') {
        return false;
    }

    return hasComponentDecoratorImport(decorator.getSourceFile());
}

function hasComponentDecoratorImport(sourceFile: SourceFile) {
    return !isUndefined(sourceFile.getImportDeclaration(isComponentDecoratorImport))
}

function isComponentDecoratorImport(importDeclaration: ImportDeclaration) {
    if (importDeclaration.getModuleSpecifier().getLiteralValue() !== '@angular/core') {
        return false;
    }

    return importDeclaration.getNamedImports()
        .some(namedImport => namedImport.getName() === 'Component')
}

async function readWorkspace(path: string): Promise<Workspace> {
    return JSON.parse(await fs.readFile(path, 'utf-8'));
}

function getProjects(workspace: Workspace): Project[] {
    return map(workspace.projects, (project, name) => ({
        name,
        ...project
    }))
}

function getTsConfigPathForProject(workspacePath: string, { projectType, root }: Project) {
    const fileNameMapping = {
        [ProjectType.Application]: 'tsconfig.app.json',
        [ProjectType.Library]: 'tsconfig.lib.json'
    }

    return path.join(workspacePath, root, fileNameMapping[projectType])
}

function getTsProject(workspacePath: string) {
    const tsConfigFilePath = getRootTsConfigPath(workspacePath);
    const absoluteTsConfigFilePath = path.join(process.cwd(), tsConfigFilePath);

    console.log(cyan(`Reading tsconfig from ${white(absoluteTsConfigFilePath)}.`));

    return new TsProject({ tsConfigFilePath });
}

function getRootTsConfigPath(workspacePath: string) {
    const tsConfigFileNames = ['tsconfig.json', 'tsconfig.base.json'];
    const tsConfigFileName = tsConfigFileNames
        .find(fileName => existsSync(path.join(process.cwd(), workspacePath, fileName)));

    if (isUndefined(tsConfigFileName)) {
        console.error(red(`No tsconfig file found in workspace directory:`));
        tsConfigFileNames
            .map(fileName => path.join(workspacePath, fileName))
            .forEach(filePath => console.error(red(`  ${filePath}`)));
        process.exit(-1);
    }

    return path.join(workspacePath, tsConfigFileName);
}

async function getAngularWorkspace(workspacePath: string) {
    const angularJsonPath = path.join(workspacePath, 'angular.json');
    const absoluteAngularJsonPath = path.join(process.cwd(), angularJsonPath);

    console.log(cyan(`Reading angular.json from ${white(absoluteAngularJsonPath)}.`));

    return await readWorkspace(angularJsonPath);
}