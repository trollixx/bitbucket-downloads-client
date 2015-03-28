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

var BbDlClient = require('../');
var fs = require('fs');

// BitBucket credentials
var credentials = {
  repository: process.env.BITBUCKET_REPOSITORY || '',
  username: process.env.BITBUCKET_USERNAME || '',
  password: process.env.BITBUCKET_PASSWORD || ''
};

if (credentials.repository.length === 0) {
  process.stderr.write('Environment variable BITBUCKET_REPOSITORY must be set in order to run tests!');
  process.abort();
}

if (credentials.username.length === 0) {
  process.stderr.write('Environment variable BITBUCKET_USERNAME must be set in order to run tests!');
  process.abort();
}

if (credentials.password.length === 0) {
  process.stderr.write('Environment variable BITBUCKET_PASSWORD must be set in order to run tests!');
  process.abort();
}

var UploadData = [
  {
    name: 'buffer.txt',
    data: new Buffer('A sample text.')
  },
  {
    name: 'stream.txt',
    data: fs.createReadStream(__dirname + '/fixtures/stream.txt')
  }
];

describe('A good guy', function () {
  var client;
  var idsToRemove = [];

  it('creates a client instance', function () {
    var fn = function () {
      client = new BbDlClient(credentials.repository);
    };
    expect(fn).not.toThrow();
  });

  it('tries to login to BitBucket', function (done) {
    client.login(credentials.username, credentials.password, function (err) {
      expect(err).toBeNull();
      done();
    });
  });

  it('retrieves file list (should be empty)', function (done) {
    client.list(function (err, items) {
      expect(err).toBeNull();
      expect(Array.isArray(items)).toBeTruthy();
      expect(items.length).toEqual(0);
      done();
    });
  });

  UploadData.forEach(function (upload) {
    it('uploads file ' + upload.name, function (done) {
      client.upload(upload.name, upload.data, function (err) {
        expect(err).toBeNull();
        done();
      });
    });
  });

  it('verifies uploads', function (done) {
    client.list(function (err, items) {
      expect(err).toBeNull();
      expect(Array.isArray(items)).toBeTruthy();
      expect(items.length).toEqual(UploadData.length);

      // List of files on BitBucket is sorted by upload time
      for (var i = 0; i < UploadData.length; ++i) {
        expect(items[i].name).toEqual(UploadData[UploadData.length - i - 1].name);
        idsToRemove.push(items[i].id);
      }

      done();
    });
  });

  it('deletes uploaded files', function (done) {
    client.remove(idsToRemove, function (err) {
      expect(err).toBeNull();
      idsToRemove = [];
      done();
    });
  });

  it('verifies that files have been removed', function (done) {
    client.list(function (err, items) {
      expect(err).toBeNull();
      expect(Array.isArray(items)).toBeTruthy();
      expect(items.length).toEqual(0);
      done();
    });
  });

  it('logs out', function (done) {
    client.logout(function (err) {
      expect(err).toBeNull();
      done();
    });
  });
});

describe('A bad guy', function () {
  var client;

  it('creates a client instance', function () {
    var fn = function () {
      client = new BbDlClient(credentials.repository);
    };
    expect(fn).not.toThrow();
  });

  it('tries to login to BitBucket with wrong credentials', function (done) {
    client.login(credentials.username, 'WrongPassword', function (err) {
      expect(err).toEqual(jasmine.any(Error));
      expect(err.message).toEqual('Login failed.');
      done();
    });
  });
});
