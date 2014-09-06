var PbfReader = require('../lib/pbfreader');

var assert = require('assert');

describe('PbfReader', function () {
	describe('readFile()', function () {
		it('events sync', function (done) {
            var reader = new PbfReader();
            var blockCount = 0;
            
            reader.on('error', function (err) {                
                assert.fail(err);
            });
            reader.on('header', function (header) {                
                assert.ok(header);
            });
            reader.on('data', function (data) {                
                blockCount++;
            });
            reader.on('end', function () {
                assert.equal(blockCount, 9);
                done();
            });
            
            reader.readFile(__dirname + '/data/mauritius.osm.pbf');            
		});
        it('events async', function (done) {
            var reader = new PbfReader();
            var blockCount = 0;
            
            reader.on('error', function (err) {
                assert.fail(err);
            });
            reader.on('header', function (header, next) {                
                setImmediate(function () {
                    assert.ok(header);
                    next();
                });
            });
            reader.on('data', function (data, next) {                
                setImmediate(function () {
                    blockCount++;
                    next();
                });
            });
            reader.on('end', function () {
                assert.equal(blockCount, 9);
                done();
            });
            
            reader.readFile(__dirname + '/data/mauritius.osm.pbf');            
		});
    });
});