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

	class Responser {
		constructor (response) {
			
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
				var headers = this.mime[mime] || this.mime['.txt'];
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

	class FileSender extends Responser {
		constructor (response, filePath) {
			super(response);

			this.path = filePath;
			this.defaultFile = 'index.html';
			
			this.sendFile = function () {
				const self = this;
				function _send(fd, pos) {
					const size = 1024;

					fs.read(fd, new Buffer(size), 0, size, pos, function (err, bytesRead, buffer) {
						if (err)
							self.response.end();
						else
							self.response.write(buffer, function () {
								if (bytesRead < size)
									self.response.end();
								else
									_send.call(self, fd, pos + bytesRead);
							});
					});
				}

				fs.stat(this.path, function (err, stats) {
					if (err) {
						self.sendError(404, 'File ' + path.basename(self.path) + ' not found.');
					} else if (stats.isFile()) {
						self.setStatus(200).setMime(path.extname(self.path));
						fs.open(self.path, 'r', function (err, fd) {
							if (err) {
								self.sendError(520, err.Error);
							} else {
								self.response.setHeader('Content-length', stats.size);
								self.response.setHeader('Last-Modified', stats.mtime.toUTCString());
								_send.call(self, fd, 0);
							}
						});
					} else if (stats.isDirectory()) {
						self.path = path.normalize(path.join(self.path, self.defaultFile));
						self.sendFile();
					} else {
						self.sendError(404, 'Incorrect path');
					}
				});
			};
		}
	};

	class Job extends Responser {
		constructor (response, name) {
			super(response);

			this.name = name;

			this.cmd = '';

			this.sendString = function (str, code, msg) {
				this.setStatus(code || 200, msg);
				this.response.setHeader('Content-length', this.name.length);
				this.response.setHeader('Content-type', 'text/plain');
				this.response.end(str);
				return this;
			}

			this.performTask = function (args, opts) {
				return spawn('scanimage', args, opts);
			}

			this.findScanners = function () {
				var data = '';
				const scan = this.performTask(['-f %i\t%d\t%v\t%m\t%n']);
				const self = this;

				scan.stdout.on('data', function (chunk) {data += chunk;});
				scan.stdout.on('end', function () {
					data = data.split('\n');
					var list = [];
					for (var i = 0, l = data.length; i < l; ++i) {
						var raw = data[i];
						if (!raw)
							continue;
						raw = raw.trim().split('\t');
						list.push({
							i: +raw[0],
							name: raw[1],
							description: [raw[2], raw[3]].join(' ')
						});
					}
					list.sort(function (a, b) {return a.i - b.i});
					self.setStatus(200).setMime('json').response.end(JSON.stringify(list));
				});
				scan.stderr.on('data', function () {self.sendError(520);});
			}
		}
	}

	class Jobber extends EventEmitter {
		constructor () {
			super();

			this.inJobs = {};

			this.updateJob = function (jobName, response) {
				var job = this[jobName];
				if (!job)
					new Responser(response).sendError(401, 'Conection not initialized');
				else
					job.setResponse(response);
				return job;
			}
		}
	}

	class Server extends http.Server {
		constructor (port, root) {
			
			super();

			this.root = root;

			this.statusList = statuses;
			this.mime = mime;

			this.jobs = {};

			this.on('initJob', function (response) {
				var name = md5(new Date().getTime().toString(36));
				while (this[name])
					name = md5(name + rndstr(10));
				this.jobs[name] = new Job(response, name);
				this.jobs[name].sendString(name, 201, 'Conection initialized');
			});

			this.on('stopJob', function (job) {
				delete this.jobs[job];
			});

			this.on('request', function (request, response) {
				this.emit(request.method.toLowerCase(), request, response);
			});

			this.on('get', function (request, response) {
				new FileSender(response, path.join(this.root, request.url)).sendFile();
			});

			this.up = function () {
				this.listen(parseInt(port) || 80);
				this.emit('fired');
				return this;
			};
		}
	};

	exports.Responser = Responser;
	exports.FileSender = FileSender;
	exports.Server = Server;
})()