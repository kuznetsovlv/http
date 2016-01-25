(function () {
	"use strict";

	const http = require('http');
	const fs = require('fs');
	const path = require('path');
	const Buffer = require('buffer').Buffer;
	const spawn = require('child_process').spawn;
	const utils = require('utils');
	const EventEmitter = require('events');

	const md5 = require('./lib/md5.js');
	const mime = require('./lib/mime.js');
	const rndstr = require('./lib/rndstr.js');
	const statuses = utils.joiny(http.STATUS_CODES, require('./lib/status.js'));

	class Responser extends EventEmitter{
		constructor (response) {
			super();

			this.statusList = statuses;
			this.mime = mime;

			this.setResponse = function (response) {
				this.response = response;
			}

			this.setStatus = function (code, msg) {
				if (!code)
					code = 520;
				this.response.statusCode = code;
				this.response.statusMessage = msg || this.statusList[code] || '';
				return this;
			};

			this.setMime = function (mime) {
				if (mime.substr(0, 1) !== '.')
					mime = '.' + mime;
				const headers = this.mime[mime] || this.mime['.txt'];
				for (var key in headers)
					this.response.setHeader(key, headers[key]);
				return this;
			};

			this.sendError = function (code, msg) {
				this.setStatus(code || 404, msg);
				this.response.end();
				return this;
			};

			this.setResponse(response);
		}
	}

	class Job extends Responser {
		constructor (response, name, server) {
			super(response);

			this.name = name;

			this.server = server;

			this.setResponse = function (response) {
				this.response = response;
				return this;
			}

			this.sendString = function (str, code, msg) {
				this.setStatus(code || 200, msg);
				this.response.setHeader('Content-length', this.name.length);
				this.response.setHeader('Content-type', 'text/plain');
				this.response.end(str);
				return this;
			}

			this.on('stop', () => {
				const str = 'job ' + this.name + ' finished.';
				this.sendString(str, 200, str);
				delete this.server.job[this.name];
			});
		}
	}

	class Server extends http.Server {
		constructor (port, root) {
			
			super();

			this.root = root;

			this.statusList = statuses;
			this.mime = mime;

			this.jobs = {};

			Object.defineProperties(this.jobs, {
				events: {
					value: {
						on: {},
						once: {}
					},
					enumerable: false;
				},
				on: {
					value: ('type', handler) => {
						var on = this.events.on;
						if (on[type])
							on[type].push(handler);
						else
							on[type] = [handler];
						for (var key in jobs)
							jobs[key].on(type, handler);
						return this;
					},
					enumerable: false;
				},
				once: {
					value: ('type', handler) => {
						var once = this.events.once;
						if (once[type])
							once[type].push(handler);
						else
							once[type] = [handler];
						for (var key in jobs)
							jobs[key].once(type, handler);
						return this;
					},
					enumerable: false;
				}
			});

			this.sendFile = function (file, mime) {
				const self = this;
				function _send(fd, pos) {
					const size = 1024;

					fs.read(fd, new Buffer(size), 0, size, pos, (err, bytesRead, buffer) => {
						if (err)
							self.response.end();
						else
							self.response.write(buffer, () => {
								if (bytesRead < size)
									self.response.end();
								else
									_send.call(self, fd, pos + bytesRead);
							});
					});
				}

				fs.stat(file, (err, stats) => {
					if (err) {
						self.sendError(404, 'File ' + path.basename(self.path) + ' not found.');
					} else if (stats.isFile()) {
						self.setStatus(200).setMime(mime || path.extname(self.path));
						fs.open(self.path, 'r', (err, fd) => {
							if (err) {
								self.sendError(520, err.Error);
							} else {
								self.response.setHeader('Content-length', stats.size);
								self.response.setHeader('Last-Modified', stats.mtime.toUTCString());
								_send.call(self, fd, 0);
							}
						});
					} else if (stats.isDirectory()) {
						self.sendFile(path.normalize(path.join(file, self.defaultFile, mime)));
						self.sendFile();
					} else {
						self.sendError(404, 'Incorrect path');
					}
				});
				return this;
			};

			this.on('initJob', (response) => {
				var name = md5(new Date().getTime().toString(36));
				
				function _setEvents (job, type) {
					const set = this.jobs.events[type];

					for (var key in set) {
						var list = set[key];
						for (var i = 0, l = list.length; i < l; ++i)
							job[type](key, list[i]);
					}
				}

				while (this[name])
					name = md5(name + rndstr(10));
				this.jobs[name] = new Job(response, name);

				_setEvents.call(this, this.jobs[name], 'once');
				_setEvents.call(this, this.jobs[name], 'on');				

				this.jobs[name].sendString(name, 201, 'Conection initialized');
			});

			this.on('request', (request, response) => {
				this.emit(request.method.toLowerCase(), request, response);
			});

			this.on('get', (request, response) => {
				this.sendFile(path.join(this.root, request.url));
			});

			this.on('pop', (request, response) => {
				if (!request.url) {
					this.emit('initJob', response);
				} else {
					var data = [];
					request.on('data', (chunk) => {data.push(chunk);});
					request.on('end', () => {
						try {
							this.jobs[request.url].setResponse(response).emit('data', request.headers['content-type'], data);
						} catch (e) {
							response.statusCode = 400;
							response.statusMessage = 'Incorrect url';
							response.end();
						}
					});
				}
			});

			this.up = function () {
				this.listen(parseInt(port) || 80);
				this.emit('fired');
				return this;
			};
		}
	};

	exports.Responser = Responser;
	exports.Server = Server;
})()