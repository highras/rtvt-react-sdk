'use strict'

const FPClient = require('./fpnn/FPClient');
const FPConfig = require('./fpnn/FPConfig');
const FPEvent = require('./fpnn/FPEvent');
const FPSocket = require('./fpnn/FPSocket');
const FPPackage = require('./fpnn/FPPackage');
const FPCallback = require('./fpnn/FPCallback');
const FPProcessor = require('./fpnn/FPProcessor');
const FPError = require('./fpnn/FPError');

const ElectronImpl = require('./fpnn/platform/ElectronImpl');

module.exports = {
	FPClient,
	FPConfig,
	FPEvent,
	FPSocket,
	FPPackage,
	FPCallback,
	FPProcessor,
	FPError,
	ElectronImpl,
};
