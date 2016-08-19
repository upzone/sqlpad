var runQuery = require('../lib/run-query.js');
var sanitize = require("sanitize-filename");
var moment = require('moment');
var async = require('async');
var router = require('express').Router();
var config = require('../lib/config.js');
var decipher = require('../lib/decipher.js');
var Connection = require('../models/Connection.js');
var Cache = require('../models/Cache.js');
var Query = require('../models/Query.js');


router.get('/api/query-result/:_queryId', function (req, res) {
    Query.findOneById(req.params._queryId, function (err, query) {
        if (err) {
            return res.send({
                success: false,
                error: err.toString()
            });
        }
        if (!query) {
            return res.send({
                success: false,
                error: "Query not found for that Id (please save query first)"
            });
        }
        var data = {
            connectionId: query.connectionId,
            cacheKey: query._id,
            queryName: query.name,
            queryText: query.queryText
        };
        getQueryResult(data, function (err, queryResult) {
            if (err) {
                return res.send({
                    success: false,
                    error: err.toString()
                });
            }
            return res.send({
                success: true,
                queryResult: queryResult
            });  
        });
    })
});

router.post('/api/query-result', function (req, res) {
    // accepts raw inputs from client
    // used during query editing
    var data = {
        connectionId: req.body.connectionId,
        cacheKey: req.body.cacheKey,
        queryName: req.body.queryName,
        queryText: req.body.queryText
    };
    getQueryResult(data, function (err, queryResult) {
        if (err) {
            return res.send({
                success: false,
                error: err.toString()
            });
        }
        return res.send({
            success: true,
            queryResult: queryResult
        });  
    });
});



function getQueryResult (data, getQueryResultCallback) {
    async.waterfall([
        function startwaterfall (waterfallNext) {
            waterfallNext(null, data);
        },
        getConnection,
        updateCache,
        execRunQuery,
        createDownloads
    ], function (err, data) {
        return getQueryResultCallback(err, data.queryResult);
    });
}


// get the query from the provided queryId in body
// this allows executing a query relying on the saved query text
// instead of relying on an open endpoint that executes arbitrary sql 
function getQuery (req, res, next) {
    console.log("TODO");
}


function getConnection (data, next) {
    Connection.findOneById(data.connectionId, function (err, connection) {
        if (err) return next(err);
        if (!connection) return next("Please choose a connection");
        connection.maxRows = Number(config.get('queryResultMaxRows'));
        connection.username = decipher(connection.username);
        connection.password = decipher(connection.password);
        data.connection = connection;
        return next(null, data);
    });
}

function updateCache (data, next) {
    var connection = data.connection;
    var now = new Date();
    var expirationDate = new Date(now.getTime() + (1000 * 60 * 60 * 8)); // 8 hours in the future.
    Cache.findOneByCacheKey(data.cacheKey, function (err, cache) {
        if (!cache) {
            cache = new Cache({cacheKey: data.cacheKey});
        }
        cache.queryName = sanitize((data.queryName || "SqlPad Query Results") + " " + moment().format("YYYY-MM-DD"));
        cache.expiration = expirationDate;
        cache.save(function (err, newCache) {
            if (err) console.error(err);
            data.cache = newCache;
            return next(null, data);
        });
    });    
}

function execRunQuery (data, next) {
    runQuery(data.queryText, data.connection, function (err, queryResult) {
        if (err) return next(err);
        data.queryResult = queryResult;
        return next(null, data);
    });
}

function createDownloads (data, next) {
    const ALLOW_CSV_DOWNLOAD = config.get('allowCsvDownload');
    if (ALLOW_CSV_DOWNLOAD) {
        var queryResult = data.queryResult;
        var cache = data.cache;
        cache.writeXlsx(queryResult, function () {
            cache.writeCsv(queryResult, function () {
                return next(null, data);    
            });
        });
    } else {
        return next(null, data);
    }
}

module.exports = router;