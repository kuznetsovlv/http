(function () {
	"use strict";

	const nums = '1234567890';
	const small = 'qwertyuiopasdfghjklzxcvbnm';
	const str = nums + small + small.toUpperCase() + '!@#$%^&*()_+~`-={}[]\\|;:"\',.<>?/';

	module.exports = function (length) {
		var res = '',
		    l = str.length;
		while (length--) {
			res += str[Math.floor(Math.random() * l)];
		}
		return res;
	}

})()