#!/usr/bin/env node

import { cyan, green, red, white, yellow } from 'chalk';
import { existsSync, promises as fs } from 'fs';
import { isUndefined, map } from 'lodash';
import * as path from 'path';
import { Project as TsProject, SourceFile } from 'ts-morph';
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

    for (const sourceFile of tsProject.getSourceFiles()) {
        await convertImportPaths(sourceFile);
    }

    console.log(green(`Import path conversion completed.`));
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

async function convertImportPaths(sourceFile: SourceFile) {
    console.log(`Converting imports in ${yellow(sourceFile.getFilePath())}.`);

    sourceFile.getImportDeclarations()
        .filter(importDeclaration => (
            importDeclaration.getModuleSpecifierValue().startsWith('apps/') ||
            importDeclaration.getModuleSpecifierValue().startsWith('libs/')
        ))
        .forEach(importDeclaration => importDeclaration.setModuleSpecifier(
            sourceFile.getRelativePathAsModuleSpecifierTo(importDeclaration.getModuleSpecifierSourceFile()!)
        ))

    return await saveChanges(sourceFile);
}

async function saveChanges(sourceFile: SourceFile) {
    // sourceFile.formatText({ baseIndentSize: 4 });
    return await sourceFile.save();
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