module.exports = PbfReader;

var fs = require('fs');
var zlib = require('zlib');
var util = require('util');
var events = require('events');
var _ = require('underscore');

var osm = require('node-osm');

var Schema = require('protobuf').Schema;
var schema = new Schema(fs.readFileSync(__dirname + '/osm.desc'));

function PbfReader() {
    events.EventEmitter.call(this);

    this.position = 0;
    this.length = 0;
}

util.inherits(PbfReader, events.EventEmitter);

PbfReader.prototype.readFile = function (path) {
    var self = this;

    fs.open(path, 'r', function (err, fd) {
        if (err) {
            self.emit('error', err);
            return;
        }

        fs.fstat(fd, function (err, stats) {
            if (err) {
                self.emit('error', err);
                return;
            }

            self.position = 0;
            self.length = stats.size;

            function readNextFileBlock() {
                if (self.position < self.length) {
                    self._readFileBlock(fd, function (err, blobHeader, blobData) {
                        if (err)
                            self.emit('error', err);
                        else {
                            self._handleFileBlock(blobHeader, blobData, function (err) {
                                if (err) {
                                    self.emit('error', err);
                                    return;
                                }

                                readNextFileBlock();
                            });
                        }
                    });
                }
                else {
                    self.emit('end');
                }
            }

            readNextFileBlock();
        });
    });
};

PbfReader.prototype._readFileBlock = function (fd, callback) {
    var self = this;

    var buffer = new Buffer(64 * 1024);

    fs.read(fd, buffer, 0, buffer.length, self.position, function (err, bytesRead, buffer) {
        var headerLength = buffer.readInt32BE(0);
        self.position += 4;

        var blobHeader = schema.BlobHeader.parse(buffer.slice(4, 4 + headerLength));
        self.position += headerLength;

        buffer = new Buffer(blobHeader.dataSize);
        fs.read(fd, buffer, 0, buffer.length, self.position, function (err, bytesRead, buffer) {
            var blob = schema.Blob.parse(buffer);

            if (blob.rawData) {
                self.position += blobHeader.dataSize;
                callback(null, blobHeader, blob.rawData);
            }
            else {
                zlib.inflate(blob.zlibData, function (err, rawData) {
                    if (err) {
                        self.emit('error', err);
                        return;
                    }

                    self.position += blobHeader.dataSize;
                    callback(null, blobHeader, rawData);
                });
            }
        });
    });
};

PbfReader.prototype._handleFileBlock = function (blobHeader, blobData, callback) {
    var self = this;

    switch (blobHeader.type) {
    case 'OSMHeader':
        self._readOsmHeader(blobData, callback);
        break;
    case 'OSMData':
        self._readOsmData(blobData, callback);
        break;
    }
};

PbfReader.prototype._readOsmHeader = function (blobData, callback) {
    var self = this;

    self.emit('header', schema.HeaderBlock.parse(blobData));
    callback();
};

PbfReader.prototype._readOsmData = function (blobData, callback) {
    var self = this;

    var primitiveBlock = schema.PrimitiveBlock.parse(blobData);

    for (var i = 0; i < primitiveBlock.stringTable.values.length; i++)
        primitiveBlock.stringTable.values[i] = primitiveBlock.stringTable.values[i].toString();

    var data = new osm.Data();

    for (i = 0; i < primitiveBlock.primitiveGroups.length; i++) {
        var primitiveGroup = primitiveBlock.primitiveGroups[i];

        if (!_.isUndefined(primitiveGroup.nodes))
            data.nodes.push.apply(data.nodes, self._readNodes(primitiveGroup.nodes, primitiveBlock));
        if (!_.isUndefined(primitiveGroup.denseNodes))
            data.nodes.push.apply(data.nodes, self._readDenseNodes(primitiveGroup.denseNodes, primitiveBlock));
        if (!_.isUndefined(primitiveGroup.ways))
            data.ways.push.apply(data.ways, self._readWays(primitiveGroup.ways, primitiveBlock));
        if (!_.isUndefined(primitiveGroup.relations))
            data.relations.push.apply(data.relations, self._readRelations(primitiveGroup.relations, primitiveBlock));
    }

    self.emit('data', data);
    callback();
};

PbfReader.prototype._readNodes = function (pbfNodes, primitiveBlock) {
    return [];
};

PbfReader.prototype._readDenseNodes = function (pbfDenseNodes, primitiveBlock) {
    var self = this;

    var nodes = [];

    var keyValueIndex = 0;

    for (var i = 0; i < pbfDenseNodes.ids.length; i++) {
        var node = new osm.Node();

        node.id = self._deltaDecompress(pbfDenseNodes.ids, i);

        node.latitude = self._deltaDecompress(pbfDenseNodes.latitudes, i) * primitiveBlock.granularity * 0.000000001;
        node.longitude = self._deltaDecompress(pbfDenseNodes.longitudes, i) * primitiveBlock.granularity * 0.000000001;

        if (!_.isUndefined(primitiveBlock.latitudeOffset))
            node.latitude += parseInt(primitiveBlock.latitudeOffset, 10);
        if (!_.isUndefined(primitiveBlock.longitudeOffset))
            node.longitude += parseInt(primitiveBlock.longitudeOffset, 10);

        if (!_.isUndefined(pbfDenseNodes.keyValues)) {
            while (pbfDenseNodes.keyValues[keyValueIndex] !== 0) {
                var key = primitiveBlock.stringTable.values[pbfDenseNodes.keyValues[keyValueIndex++]];
                var value = primitiveBlock.stringTable.values[pbfDenseNodes.keyValues[keyValueIndex++]];

                node.tags[key] = value;
            }
        }

        keyValueIndex++;

        nodes.push(node);
    }

    return nodes;
};

PbfReader.prototype._readWays = function (pbfWays, primitiveBlock) {
    var self = this;

    var ways = [];

    for (var i = 0; i < pbfWays.length; i++) {
        var way = new osm.Way();

        way.id = parseInt(pbfWays[i].id, 10);
        way.nodeReferences = self._deltaDecompress(pbfWays[i].nodeReferences);

        if (pbfWays[i].keys && pbfWays[i].values) {
            for (var j = 0; j < pbfWays[i].keys.length; j++) {
                var key = primitiveBlock.stringTable.values[pbfWays[i].keys[j]];
                var value = primitiveBlock.stringTable.values[pbfWays[i].values[j]];

                way.tags[key] = value;
            }
        }

        ways.push(way);
    }

    return ways;
};

PbfReader.prototype._readRelations = function (pbfRelations, primitiveBlock) {
    var self = this;

    var relations = [];

    for (var i = 0; i < pbfRelations.length; i++) {
        var relation = new osm.Relation();

        relation.id = parseInt(pbfRelations[i].id, 10);

        var members = self._deltaDecompress(pbfRelations[i].members);

        for (var j = 0; j < members.length; j++) {
            relation.members.push(new osm.Member(
                pbfRelations[i].types[j],
                members[j],
                primitiveBlock.stringTable.values[pbfRelations[i].roles[j]]
            ));
        }

        if (pbfRelations[i].keys && pbfRelations[i].values) {
            for (j = 0; j < pbfRelations[i].keys.length; j++) {
                var key = primitiveBlock.stringTable.values[pbfRelations[i].keys[j]];
                var value = primitiveBlock.stringTable.values[pbfRelations[i].values[j]];

                relation.tags[key] = value;
            }
        }

        relations.push(relation);
    }

    return relations;
};

PbfReader.prototype._deltaDecompress = function (values, index) {
    if (!_.isUndefined(index)) {
        if (index > 0)
            values[index] = values[index - 1] + parseInt(values[index], 10);
        else
            values[index] = parseInt(values[index], 10);

        return values[index];
    }
    else {
        for (var i = 0; i < values.length; i++) {
            if (i > 0)
                values[i] = values[i - 1] + parseInt(values[i], 10);
            else
                values[i] = parseInt(values[i], 10);
        }

        return values;
    }
};