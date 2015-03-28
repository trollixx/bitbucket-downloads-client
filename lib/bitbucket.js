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

/**
 * Creates a new instance of BitBucket Downloads client.
 * @param {string} repository - BitBucket repository in `owner/repo` format.
 * @constructor
 */
var Client = function (repository) {
  this.cookieJar = request.jar();
  this.request = request.defaults({jar: this.cookieJar});
  this.pageUrl = 'https://bitbucket.org/' + repository + '/downloads';
  this.loggedIn = false;

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
 * Callback function that is called by methods, which only notify about success or failure of operation,
 * but do not return any additional information.
 * @callback Callback
 * @param {(Error|null)} err
 */

/**
 * Tries to authenticate on BitBucket with given `userName` and `password`.
 * Please note, that it is possible to use BitBucket team credentials in addition to regular user accounts.
 * @param {string} userName - User name.
 * @param {string} password - Password.
 * @param {Callback} callback
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

      self.loggedIn = true;
      return callback(null);
    });
  });
};

/**
 * Signs out from BitBucket.
 * @param {Callback} callback
 */
Client.prototype.logout = function (callback) {
  if (!this.loggedIn)
    return callback(new Error('Authentication required.'));

  this.request('https://bitbucket.org/account/signout/', function (err) {
    if (err)
      return callback(err);

    /// TODO: Check if logout succeeded
    this.loggedIn = false;
    return callback(null);
  });
};

/**
 * An object that contains information about one file listed on repository Downloads page.
 * @typedef {Object} DownloadItem
 * @property {string} id - Identifier used by BitBucket for deleting files.
 * @property {string} name - File name.
 * @property {string} size - File size in string format (e.g. 32 M).
 * @property {number} count - Download count.
 * @property {string} user - Uploader user name (can be team account).
 * @property {Date} date - Upload date.
 */

/**
 * Callback function that is called by methods, which only notify about success or failure of operation,
 * but do not return any additional information.
 * @callback ListCallback
 * @param {Error|null} err
 * @param {DownloadItem[]} items - Array with information about files available for download.
 */

/**
 * Retrieves list of files available for download.
 * @param {ListCallback} callback
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
        count: parseInt(el.children('td.count').text(), 10),
        user: el.find('td.uploaded-by a').text(),
        date: new Date(el.find('time').attr('datetime'))
      };
      items.push(item);
    });

    return callback(null, items);
  });
};

/**
 * Uploads file to BitBucket.
 * @param {string} filename - File name.
 * @param {(Buffer|stream.Readable)} payload - File data.
 * @param {Callback} callback
 */
Client.prototype.upload = function (filename, payload, callback) {
  if (typeof filename !== 'string' || !filename.length)
    return callback(new Error('Filename must be a non empty string.'));

  if (!this.loggedIn)
    return callback(new Error('Authentication required.'));

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
  } else if (payload instanceof stream.Readable && payload.readable) {
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

/**
 * Removes files from project Downloads page.
 * @param {(string[]|string)} ids - Identifiers of files to remove.
 * @param {Callback} callback
 */
Client.prototype.remove = function (ids, callback) {
  if (!this.loggedIn)
    return callback(new Error('Authentication required.'));

  var ids = Array.isArray(ids) ? ids : [ids];

  var self = this;

  self.request(self.pageUrl, function (err) {
    if (err)
      return callback(err);

    var failed = false;

    ids.forEach(function (id) {
      if (failed)
        return;

      var postOptions = {
        url: self.pageUrl + '/delete',
        form: {
          csrfmiddlewaretoken: self.csrf(),
          token: '',
          file_id: id
        },
        headers: {
          referer: self.pageUrl
        }
      };

      self.request.post(postOptions, function (err) {
        if (failed)
          return;

        if (err) {
          failed = true;
          return callback(err);
        }

        ids.splice(ids.indexOf(id), 1);
        if (ids.length === 0)
          return callback(null);
      });
    });
  });
};

module.exports = Client;
