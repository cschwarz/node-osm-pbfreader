node-osm-pbfreader
==================

A node.js module for working with OpenStreetMap PBF files.

Usage
-----

```javascript
var PbfReader = require('node-osm-pbfreader');

var reader = new PbfReader();

reader.on('header', function (header) {
    console.log('header: ' + header);
});
reader.on('data', function (data) {
    console.log('data: ' + data);
});
reader.on('end', function () {
    console.log('end');
});
reader.on('error', function (err) {
    console.log('error: ' + err);
});

reader.readFile('austria-latest.osm.pbf');
```
