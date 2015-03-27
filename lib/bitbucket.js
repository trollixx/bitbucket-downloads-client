/*
 Copyright (c) 2015 Oleg Shparber (trollixx@gmail.com)

 Permission is hereby granted, free of charge, to any person obtaining a copy
 of this software and associated documentation files (the "Software"), to deal
 in the Software without restriction, including without limitation the rights
 to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 copies of the Software, and to permit persons to whom the Software is
 furnished to do so, subject to the following conditions:

 The above copyright notice and this permission notice shall be included in all
 copies or substantial portions of the Software.

 THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 SOFTWARE.
 */

var cheerio = require('cheerio')
  , stream = require('stream')
  , request = require('request');

var Client = function (repository) {
  this.cookieJar = request.jar();
  this.request = request.defaults({jar: this.cookieJar});
  this.pageUrl = 'https://bitbucket.org/' + repository + '/downloads';

  this.csrf = function () {
    var cookies = this.cookieJar.getCookies('https://bitbucket.org/');
    for (var i = 0; i < cookies.length; ++i) {
      if (cookies[i].key !== 'csrftoken')
        continue;
      return cookies[i].value;
    }

    return '';
  };
};

/**
 *
 * @param userName
 * @param password
 * @param callback
 */
Client.prototype.login = function (userName, password, callback) {
  var self = this;
  // Obtain CSRF token first
  self.request('https://bitbucket.org/account/signin/', function (err, res) {
    if (err)
      return callback(err);

    if (!self.csrf().length)
      return callback(new Error('Error obtaining CSRF token'));

    var postOptions = {
      url: 'https://bitbucket.org/account/signin/',
      form: {
        username: userName,
        password: password,
        submit: '',
        next: '/',
        csrfmiddlewaretoken: self.csrf()
      },
      headers: {
        referer: 'https://bitbucket.org/account/signin/'
      }
    };

    self.request.post(postOptions, function (err, res, body) {
      if (err)
        return callback(err);

      // Bitbucket redirects on successful login
      if (res.statusCode !== 302)
        return callback(new Error('Login failed.'));

      return callback(null);
    });
  });
};

/**
 *
 * @param callback
 */
Client.prototype.logout = function (callback) {
  this.request('https://bitbucket.org/account/signout/', function (err) {
    /// TODO: Check if logout succeeded
    return callback(err);
  });
};

/**
 *
 * @param callback
 */
Client.prototype.list = function (callback) {
  var self = this;

  this.request(self.pageUrl, function (err, res, body) {
    if (err)
      return callback(err);

    if (res.statusCode !== 200)
      return callback(new Error('Request failed.'));

    var $ = cheerio.load(body);
    var items = [];

    $('#uploaded-files').find('.iterable-item').each(function () {
      var el = $(this);
      var deleteHref = el.find('td.delete a');
      var item = {
        id: deleteHref.attr('data-id'),
        name: deleteHref.attr('data-filename'),
        size: el.children('td.size').text(),
        count: el.children('td.count').text(),
        user: el.find('td.uploaded-by a').text(),
        date: new Date(el.find('time').attr('datetime'))
      };
      items.push(item);
    });

    return callback(null, items);
  });
};

/**
 *
 * @param filename
 * @param payload
 * @param callback
 */
Client.prototype.upload = function (filename, payload, callback) {
  if (typeof filename !== 'string' || !filename.length)
    return callback(new Error('Filename must be a non empty string.'));

  var self = this;

  function doUpload(filename, payload, callback) {
    // Useless request to update CSRF token
    self.request(self.pageUrl, function (err, res, body) {
      if (err)
        return callback(err);

      var postOptions = {
        url: self.pageUrl,
        formData: {
          csrfmiddlewaretoken: self.csrf(),
          token: '',
          file: {
            value: payload,
            options: {
              filename: filename,
              contentType: 'application/octet-stream'
            }
          }
        },
        headers: {
          referer: self.pageUrl
        }
      };

      self.request.post(postOptions, function (err, res, body) {
        return callback(err);
      });
    });
  }

  // Merge both conditions in one when request/request#1402 is fixed
  if (Buffer.isBuffer(payload)) {
    return doUpload(filename, payload, callback);
  } else if (payload instanceof stream.Readable) {
    var buffers = [];
    payload.on('data', function (data) {
      buffers.push(data);
    });
    payload.on('end', function () {
      return doUpload(filename, Buffer.concat(buffers), callback);
    });
  } else {
    return callback(new Error('Payload must be Buffer or readable Stream.'));
  }
};

module.exports = Client;
