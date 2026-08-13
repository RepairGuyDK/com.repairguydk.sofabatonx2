'use strict';

import Homey from 'homey';

module.exports = class SofaBatonApp extends Homey.App {

  async onInit(): Promise<void> {
    this.log('SofaBaton X2 app initialized');
  }

};
