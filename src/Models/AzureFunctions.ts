// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import * as fs from 'fs-plus';
import * as path from 'path';
import * as vscode from 'vscode';

import WebSiteManagementClient = require('azure-arm-website');
import {Component, ComponentType} from './Interfaces/Component';
import {Provisionable} from './Interfaces/Provisionable';
import {Deployable} from './Interfaces/Deployable';

import {ConfigHandler} from '../configHandler';
import {ConfigKey} from '../constants';

import {ServiceClientCredentials} from 'ms-rest';
import {AzureAccount, AzureResourceFilter} from '../azure-account.api';
import {StringDictionary} from 'azure-arm-website/lib/models';
import {getExtension} from './Apis';
import {extensionName} from './Interfaces/Api';

export class AzureFunctions implements Component, Provisionable {
  private componentType: ComponentType;
  private channel: vscode.OutputChannel;
  private azureFunctionsPath: string;
  private azureAccountExtension: AzureAccount|undefined =
      getExtension(extensionName.AzureAccount);

  private async getSubscriptionList(): Promise<vscode.QuickPickItem[]> {
    const subscriptionList: vscode.QuickPickItem[] = [];
    if (!this.azureAccountExtension) {
      throw new Error('Azure account extension is not found.');
    }

    const subscriptions = this.azureAccountExtension.filters;
    subscriptions.forEach(item => {
      subscriptionList.push({
        label: item.subscription.displayName,
        description: item.subscription.subscriptionId
      } as vscode.QuickPickItem);
    });

    if (subscriptionList.length === 0) {
      subscriptionList.push({
        label: 'No subscription found',
        description: '',
        detail:
            'Click Azure account at bottom left corner and choose Select All'
      } as vscode.QuickPickItem);
    }

    return subscriptionList;
  }

  private async getCredentialFromSubscriptionId(subscriptionId: string):
      Promise<ServiceClientCredentials|undefined> {
    if (!this.azureAccountExtension) {
      throw new Error('Azure account extension is not found.');
    }

    if (!subscriptionId) {
      throw new Error('Subscription ID is required.');
    }

    const subscriptions: AzureResourceFilter[] =
        this.azureAccountExtension.filters;
    for (let i = 0; i < subscriptions.length; i++) {
      const subscription: AzureResourceFilter = subscriptions[i];
      if (subscription.subscription.subscriptionId === subscriptionId) {
        return subscription.session.credentials;
      }
    }

    return undefined;
  }

  constructor(azureFunctionsPath: string, channel: vscode.OutputChannel) {
    this.componentType = ComponentType.AzureFunctions;
    this.channel = channel;
    this.azureFunctionsPath = azureFunctionsPath;
  }

  name = 'Azure Functions';

  getComponentType(): ComponentType {
    return this.componentType;
  }

  async load(): Promise<boolean> {
    return true;
  }

  async create(): Promise<boolean> {
    const azureFunctionsPath = this.azureFunctionsPath;
    console.log(azureFunctionsPath);

    if (!fs.existsSync(azureFunctionsPath)) {
      throw new Error(
          `Azure Functions folder doesn't exist: ${azureFunctionsPath}`);
    }

    try {
      await vscode.commands.executeCommand(
          'azureFunctions.createNewProject', azureFunctionsPath, 'C#Script',
          '~1', false /* openFolder */, 'IoTHubTrigger-CSharp',
          'IoTHubTrigger1', {
            connection: 'eventHubConnectionString',
            path: '%eventHubConnectionPath%',
            consumerGroup: '$Default'
          });
      return true;
    } catch (error) {
      throw error;
    }
  }

  async provision(): Promise<boolean> {
    try {
      const subscription = await vscode.window.showQuickPick(
          this.getSubscriptionList(),
          {placeHolder: 'Select Subscription', ignoreFocusOut: true});
      if (!subscription || !subscription.description) {
        return false;
      }
      const subscriptionId = subscription.description;
      const functionAppId: string|undefined =
          await vscode.commands.executeCommand<string>(
              'azureFunctions.createFunctionApp', subscriptionId);
      if (functionAppId) {
        await ConfigHandler.update(ConfigKey.functionAppId, functionAppId);
        const eventHubConnectionString =
            ConfigHandler.get<string>(ConfigKey.eventHubConnectionString);
        const eventHubConnectionPath =
            ConfigHandler.get<string>(ConfigKey.eventHubConnectionPath);
        const iotHubConnectionString =
            ConfigHandler.get<string>(ConfigKey.iotHubConnectionString);

        if (!eventHubConnectionString || !eventHubConnectionPath) {
          throw new Error('No event hub path or connection string found.');
        }
        const credential =
            await this.getCredentialFromSubscriptionId(subscriptionId);
        if (credential === undefined) {
          throw new Error(`Unable to get credential for the subscription, id:${
              subscriptionId}.`);
        }

        const resourceGroupMatches =
            functionAppId.match(/\/resourceGroups\/([^\/]*)/);
        if (!resourceGroupMatches || resourceGroupMatches.length < 2) {
          throw new Error('Cannot parse resource group from function app ID.');
        }
        const resourceGroup = resourceGroupMatches[1];

        const siteNameMatches = functionAppId.match(/\/sites\/([^\/]*)/);
        if (!siteNameMatches || siteNameMatches.length < 2) {
          throw new Error(
              'Cannot parse function app name from function app ID.');
        }
        const siteName = siteNameMatches[1];

        const client = new WebSiteManagementClient(credential, subscriptionId);
        console.log(resourceGroup, siteName);
        const appSettings: StringDictionary =
            await client.webApps.listApplicationSettings(
                resourceGroup, siteName);
        console.log(appSettings);
        appSettings.properties = appSettings.properties || {};
        appSettings.properties['eventHubConnectionString'] =
            eventHubConnectionString || '';
        appSettings.properties['eventHubConnectionPath'] =
            eventHubConnectionPath || '';
        appSettings.properties['iotHubConnectionString'] =
            iotHubConnectionString || '';

        await client.webApps.updateApplicationSettings(
            resourceGroup, siteName, appSettings);

        return true;
      } else {
        throw new Error(
            'Unable to create Azure Functions application. Please check the error and retry.');
      }
    } catch (error) {
      throw error;
    }
  }

  async deploy(): Promise<boolean> {
    let deployPendding: NodeJS.Timer|null = null;
    if (this.channel) {
      this.channel.show();
      this.channel.appendLine('Deploying Azure Functions App...');
      deployPendding = setInterval(() => {
        this.channel.append('.');
      }, 1000);
    }

    try {
      const azureFunctionsPath = this.azureFunctionsPath;
      const functionAppId = ConfigHandler.get(ConfigKey.functionAppId);

      await vscode.commands.executeCommand(
          'azureFunctions.deploy', azureFunctionsPath, functionAppId);
      console.log(azureFunctionsPath, functionAppId);
      if (this.channel && deployPendding) {
        clearInterval(deployPendding);
        this.channel.appendLine('.');
      }
      return true;
    } catch (error) {
      if (this.channel && deployPendding) {
        clearInterval(deployPendding);
        this.channel.appendLine('.');
      }
      throw error;
    }
  }
}