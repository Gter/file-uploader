/*globals qq, XMLHttpRequest, FormData, File*/
/*jslint white: true*/
qq.UploadHandlerXhr = function(o, uploadCompleteCallback, logCallback) {
    "use strict";
    
    var options = o,
        uploadComplete = uploadCompleteCallback,
        log = logCallback,
        files = [],
        uuids = [],
        xhrs = [],
        remainingChunks = [],
        loaded = [],
        api,
        addChunkingSpecificParams, getChunk, computeChunks, getXhr, setParamsAndGetEntityToSend, setHeaders, completed,
        uploadNextChunk, onSuccessfullyCompletedChunk, onComplete, getReadyStateChangeHandler;


    addChunkingSpecificParams = function(id, params) {
        var chunkData = remainingChunks[id][0],
            size = api.getSize(id),
            name = api.getName(id);

        params[options.chunking.paramNames.partNumber] = chunkData.part;
        params[options.chunking.paramNames.partByteOffset] = chunkData.start;
        params[options.chunking.paramNames.chunkSize] = chunkData.end - chunkData.start;
        params[options.chunking.paramNames.totalParts] = chunkData.count;
        params[options.chunking.paramNames.totalFileSize] = size;

        /**
         * When a Blob is sent in a multipart request, the filename value in the content-disposition header is either "blob"
         * or an empty string.  So, we will need to include the actual file name as a param in this case.
         */
        if (options.forceMultipart || options.paramsInBody) {
            params[options.chunking.paramNames.filename] = name;
        }
    };

    getChunk = function(file, startByte, endByte) {
        if (file.slice) {
            return file.slice(startByte, endByte);
        }
        else if (file.mozSlice) {
            return file.mozSlice(startByte, endByte);
        }
        else if (file.webkitSlice) {
            return file.webkitSlice(startByte, endByte);
        }
    };

    computeChunks = function(id) {
        var chunks = [],
            chunkSize = options.chunking.partSize,
            fileSize = api.getSize(id),
            file = files[id],
            startBytes = 0,
            part = -1,
            endBytes = chunkSize >= fileSize ? fileSize : chunkSize,
            totalChunks = Math.ceil(fileSize / chunkSize),
            chunk;

        while (startBytes < fileSize) {
            chunk = getChunk(file, startBytes, endBytes);
            part+=1;

            chunks.push({
                part: part,
                start: startBytes,
                end: endBytes,
                count: totalChunks,
                blob: chunk
            });

            startBytes += chunkSize;
            endBytes = startBytes+chunkSize >= fileSize ? fileSize : startBytes+chunkSize;
        }

        return chunks;
    };

    getXhr = function(id) {
        xhrs[id] = new XMLHttpRequest();
        return xhrs[id];
    };

    setParamsAndGetEntityToSend = function(params, xhr, fileOrBlob, id) {
        var formData = new FormData(),
            protocol = options.demoMode ? "GET" : "POST",
            url = options.endpoint,
            name = api.getName(id);

        params[options.uuidParamName] = uuids[id];

        //build query string
        if (!options.paramsInBody) {
            params[options.inputName] = name;
            url = qq.obj2url(params, options.endpoint);
        }

        xhr.open(protocol, url, true);
        if (options.forceMultipart || options.paramsInBody) {
            if (options.paramsInBody) {
                qq.obj2FormData(params, formData);
            }

            formData.append(options.inputName, fileOrBlob);
            return formData;
        }

        return fileOrBlob;
    };

    setHeaders = function(id, xhr) {
        var extraHeaders = options.customHeaders,
            name = api.getName(id),
            forceMultipart = options.forceMultipart,
            paramsInBody = options.paramsInBody,
            file = files[id];

        xhr.setRequestHeader("X-Requested-With", "XMLHttpRequest");
        xhr.setRequestHeader("X-File-Name", encodeURIComponent(name));
        xhr.setRequestHeader("Cache-Control", "no-cache");

        if (!forceMultipart && !paramsInBody) {
            xhr.setRequestHeader("Content-Type", "application/octet-stream");
            //NOTE: return mime type in xhr works on chrome 16.0.9 firefox 11.0a2
            xhr.setRequestHeader("X-Mime-Type", file.type);
        }

        qq.each(extraHeaders, function(name, val) {
            xhr.setRequestHeader(name, val);
        });
    };

    completed = function(id, response, xhr) {
        var name = api.getName(id);

        options.onComplete(id, name, response, xhr);
        delete xhrs[id];
        uploadComplete(id);
    };

    uploadNextChunk = function(id) {
        var chunkData = remainingChunks[id][0],
            xhr = getXhr(id),
            size = api.getSize(id),
            name = api.getName(id),
            toSend, params;

        xhr.onreadystatechange = getReadyStateChangeHandler(id, xhr);

        xhr.upload.onprogress = function(e) {
            if (e.lengthComputable) {
                var totalLoaded = e.loaded + loaded[id];
                options.onProgress(id, name, totalLoaded, size);
            }
        };

        options.onUploadChunk(id, name, {
            partIndex: chunkData.part,
            startByte: chunkData.start + 1,
            endByte: chunkData.end,
            totalParts: chunkData.count
        });

        params = options.paramsStore.getParams(id);
        addChunkingSpecificParams(id, params);

        toSend = setParamsAndGetEntityToSend(params, xhr, chunkData.blob, id);
        setHeaders(id, xhr);

        log('Sending chunked upload request for ' + id + ": bytes " + (chunkData.start+1) + "-" + chunkData.end + " of " + size);
        xhr.send(toSend);
    };


    onSuccessfullyCompletedChunk = function(id, response, xhr) {
        var chunk = remainingChunks[id].shift(),
            name = api.getName(id);

        loaded[id] += chunk.end - chunk.start;

        if (remainingChunks[id].length > 0) {
            uploadNextChunk(id);
        }
        else {
            completed(id, response, xhr);
        }
    };

    onComplete = function(id, xhr) {
        /*jslint evil: true*/

        var name = api.getName(id),
            size = api.getSize(id),
            response;

        // the request was aborted/cancelled
        if (!files[id]) {
            return;
        }

        if (!options.chunking.enabled || remainingChunks[id].length === 1) {
            options.onProgress(id, name, size, size);
        }

        log("xhr - server response received for " + id);
        log("responseText = " + xhr.responseText);

        try {
            if (typeof JSON.parse === "function") {
                response = JSON.parse(xhr.responseText);
            } else {
                response = eval("(" + xhr.responseText + ")");
            }
        } catch(error){
            log('Error when attempting to parse xhr response text (' + error + ')', 'error');
            response = {};
        }

        if (xhr.status !== 200 || !response.success){
            if (options.onAutoRetry(id, name, response, xhr)) {
                return;
            }
            else {
                completed(id, response, xhr);
            }
        }
        else if (options.chunking.enabled) {
            onSuccessfullyCompletedChunk(id, response, xhr);
        }
        else {
            completed(id, response, xhr);
        }
    };

     getReadyStateChangeHandler = function(id, xhr) {
        return function() {
            if (xhr.readyState === 4) {
                onComplete(id, xhr);
            }
        };
    };


    api = {
        /**
         * Adds file to the queue
         * Returns id to use with upload, cancel
         **/
        add: function(file){
            if (!(file instanceof File)){
                throw new Error('Passed obj in not a File (in qq.UploadHandlerXhr)');
            }


            var id = files.push(file) - 1;
            uuids[id] = qq.getUniqueId();

            return id;
        },
        getName: function(id){
            var file = files[id];
            // fix missing name in Safari 4
            //NOTE: fixed missing name firefox 11.0a2 file.fileName is actually undefined
            return (file.fileName !== null && file.fileName !== undefined) ? file.fileName : file.name;
        },
        getSize: function(id){
            /*jslint eqeq: true*/
            var file = files[id];
            return file.fileSize != null ? file.fileSize : file.size;
        },
        /**
         * Returns uploaded bytes for file identified by id
         */
        getLoaded: function(id){
            return loaded[id] || 0;
        },
        isValid: function(id) {
            return files[id] !== undefined;
        },
        reset: function() {
            files = [];
            uuids = [];
            xhrs = [];
            loaded = [];
            remainingChunks = [];
        },
        getUuid: function(id) {
            return uuids[id];
        },
        /**
         * Sends the file identified by id to the server
         */
        upload: function(id){
            var file = files[id],
                name = this.getName(id),
                url = options.endpoint,
                xhr,
                params,
                toSend;

            options.onUpload(id, this.getName(id));

            loaded[id] = 0;

            if (options.chunking.enabled && qq.isFileChunkingSupported()) {
                if (!remainingChunks[id] || remainingChunks[id].length === 0) {
                    remainingChunks[id] = computeChunks(id);
                }

                uploadNextChunk(id);
            }
            else {
                xhr = getXhr(id);

                xhr.upload.onprogress = function(e){
                    if (e.lengthComputable){
                        loaded[id] = e.loaded;
                        options.onProgress(id, name, e.loaded, e.total);
                    }
                };

                xhr.onreadystatechange = getReadyStateChangeHandler(id, xhr);

                params = options.paramsStore.getParams(id);
                toSend = setParamsAndGetEntityToSend(params, xhr, file, id);
                setHeaders(id, xhr);

                log('Sending upload request for ' + id);
                xhr.send(toSend);
            }
        },
        cancel: function(id){
            options.onCancel(id, this.getName(id));

            delete files[id];
            delete uuids[id];

            if (xhrs[id]){
                xhrs[id].abort();
                delete xhrs[id];
            }

            remainingChunks[id] = [];
        }
    };

    return api;
};
