// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import * as vscode from 'vscode';

import {ConfigHandler} from '../configHandler';
import {ConfigKey} from '../constants';
import {getExtension} from './Apis';
import {extensionName} from './Interfaces/Api';
import {Component, ComponentType} from './Interfaces/Component';
import {Provisionable} from './Interfaces/Provisionable';

export class IoTHub implements Component, Provisionable {
  private componentType: ComponentType;
  private channel: vscode.OutputChannel;

  constructor(channel: vscode.OutputChannel) {
    this.componentType = ComponentType.IoTHub;
    this.channel = channel;
  }

  name = 'IoT Hub';

  getComponentType(): ComponentType {
    return this.componentType;
  }

  async load(): Promise<boolean> {
    return true;
  }


  async create(): Promise<boolean> {
    return true;
  }

  async provision(): Promise<boolean> {
    const provisionIothubSelection: vscode.QuickPickItem[] = [
      {
        label: 'Select an existing IoT Hub',
        description: 'Select an existing IoT Hub',
        detail: 'select'
      },
      {
        label: 'Create a new IoT Hub',
        description: 'Create a new IoT Hub',
        detail: 'create'
      }
    ];
    const selection = await vscode.window.showQuickPick(
        provisionIothubSelection,
        {ignoreFocusOut: true, placeHolder: 'Provision IoT Hub'});

    if (!selection) {
      return false;
    }

    const toolkit = getExtension(extensionName.Toolkit);
    if (toolkit === undefined) {
      const error = new Error(
          'Azure IoT Toolkit is not installed. Please install it from Marketplace.');
      throw error;
    }

    let iothub = null;
    switch (selection.detail) {
      case 'select':
        iothub = await toolkit.azureIoTExplorer.selectIoTHub(this.channel);
        break;
      case 'create':
        if (this.channel) {
          this.channel.show();
          this.channel.appendLine('Creating new IoT Hub...');
        }

        iothub = await toolkit.azureIoTExplorer.createIoTHub(this.channel);
        break;
      default:
        break;
    }

    if (iothub && iothub.iotHubConnectionString) {
      if (this.channel) {
        this.channel.show();
        this.channel.appendLine(JSON.stringify(iothub, null, 2));
      }

      const sharedAccessKeyMatches =
          iothub.iotHubConnectionString.match(/SharedAccessKey=([^;]*)/);
      if (!sharedAccessKeyMatches || sharedAccessKeyMatches.length < 2) {
        throw new Error(
            'Cannot parse shared access key from IoT Hub connection string. Please retry Azure Provision.');
      }

      const sharedAccessKey = sharedAccessKeyMatches[1];

      const eventHubConnectionString = `Endpoint=${
          iothub.properties.eventHubEndpoints.events
              .endpoint};SharedAccessKeyName=iothubowner;SharedAccessKey=${
          sharedAccessKey}`;
      const eventHubConnectionPath =
          iothub.properties.eventHubEndpoints.events.path;

      await ConfigHandler.update(
          ConfigKey.iotHubConnectionString, iothub.iotHubConnectionString);
      await ConfigHandler.update(
          ConfigKey.eventHubConnectionString, eventHubConnectionString);
      await ConfigHandler.update(
          ConfigKey.eventHubConnectionPath, eventHubConnectionPath);

      if (this.channel) {
        this.channel.show();
        this.channel.appendLine('IoT Hub provision succeeded.');
      }
      return true;
    } else if (!iothub) {
      return false;
    } else {
      throw new Error(
          'IoT Hub provision failed. Please check output window for detail.');
    }
  }
}