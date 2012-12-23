/**
 * Class for uploading files using xhr
 * @inherits qq.UploadHandlerAbstract
 */
qq.UploadHandlerXhr = function(o){
    qq.UploadHandlerAbstract.apply(this, arguments);

    this._files = [];
    this._uuids = [];
    this._xhrs = [];

    this._remainingChunks = [];

    // current loaded size in bytes for each file
    this._loaded = [];
};

// @inherits qq.UploadHandlerAbstract
qq.extend(qq.UploadHandlerXhr.prototype, qq.UploadHandlerAbstract.prototype)

qq.extend(qq.UploadHandlerXhr.prototype, {
    /**
     * Adds file to the queue
     * Returns id to use with upload, cancel
     **/
    add: function(file){
        if (!(file instanceof File)){
            throw new Error('Passed obj in not a File (in qq.UploadHandlerXhr)');
        }


        var id = this._files.push(file) - 1;
        this._uuids[id] = qq.getUniqueId();

        return id;
    },
    getName: function(id){
        var file = this._files[id];
        // fix missing name in Safari 4
        //NOTE: fixed missing name firefox 11.0a2 file.fileName is actually undefined
        return (file.fileName !== null && file.fileName !== undefined) ? file.fileName : file.name;
    },
    getSize: function(id){
        var file = this._files[id];
        return file.fileSize != null ? file.fileSize : file.size;
    },
    /**
     * Returns uploaded bytes for file identified by id
     */
    getLoaded: function(id){
        return this._loaded[id] || 0;
    },
    isValid: function(id) {
        return this._files[id] !== undefined;
    },
    reset: function() {
        qq.UploadHandlerAbstract.prototype.reset.apply(this, arguments);
        this._files = [];
        this._uuids = [];
        this._xhrs = [];
        this._loaded = [];
        this._remainingChunks = []
    },
    getUuid: function(id) {
        return this._uuids[id];
    },
    /**
     * Sends the file identified by id to the server
     */
    _upload: function(id){
        var file = this._files[id],
            name = this.getName(id),
            self = this,
            url = this._options.endpoint,
            xhr,
            params,
            toSend;

        this._options.onUpload(id, this.getName(id), true);

        this._loaded[id] = 0;

        if (this._options.chunking.enabled && qq.isFileChunkingSupported()) {
            if (!this._remainingChunks[id] || this._remainingChunks[id].length === 0) {
                this._remainingChunks[id] = this._computeChunks(id);
            }

            this._uploadNextChunk(id);
        }
        else {
            xhr = this._getXhr(id);

            xhr.upload.onprogress = function(e){
                if (e.lengthComputable){
                    self._loaded[id] = e.loaded;
                    self._options.onProgress(id, name, e.loaded, e.total);
                }
            };

            xhr.onreadystatechange = this._getReadyStateChangeHandler(id, xhr);

            params = this._options.paramsStore.getParams(id);
            toSend = this._setParamsAndGetEntityToSend(params, xhr, file, id);
            this._setHeaders(id, xhr);

            this.log('Sending upload request for ' + id);
            xhr.send(toSend);
        }
    },
    _uploadNextChunk: function(id) {
        var chunkData = this._remainingChunks[id][0],
            xhr = this._getXhr(id),
            size = this.getSize(id),
            self = this,
            name = this.getName(id),
            params = this._options.paramsStore.getParams(id),
            toSend;

        xhr.onreadystatechange = this._getReadyStateChangeHandler(id, xhr);

        xhr.upload.onprogress = function(e) {
            if (e.lengthComputable) {
                var totalLoaded = e.loaded + self._loaded[id];
                self._options.onProgress(id, name, totalLoaded, size);
            }
        };

        this._addChunkingSpecificParams(id, params);

        toSend = this._setParamsAndGetEntityToSend(params, xhr, chunkData.blob, id);
        this._setHeaders(id, xhr);

        this.log('Sending chunked upload request for ' + id + ": bytes " + chunkData.start + "-" + chunkData.end + " of " + size);
        xhr.send(toSend);
    },
    _addChunkingSpecificParams: function(id, params) {
        var chunkData = this._remainingChunks[id][0],
            size = this.getSize(id),
            name = this.getName(id);

        params[this._options.chunking.paramNames.partNumber] = chunkData.part;
        params[this._options.chunking.paramNames.partByteOffset] = chunkData.start;
        params[this._options.chunking.paramNames.chunkSize] = chunkData.end - chunkData.start;
        params[this._options.chunking.paramNames.totalParts] = chunkData.count;
        params[this._options.chunking.paramNames.totalFileSize] = size;

        /**
         * When a Blob is sent in a multipart request, the filename value in the content-disposition header is either "blob"
         * or an empty string.  So, we will need to include the actual file name as a param in this case.
         */
        if (this._options.forceMultipart || this._options.paramsInBody) {
            params[this._options.chunking.paramNames.filename] = name;
        }
    },
    _computeChunks: function(id) {
        var chunks = [],
            chunkSize = this._options.chunking.partSize,
            fileSize = this.getSize(id),
            file = this._files[id],
            startBytes = 0,
            part = -1,
            endBytes = chunkSize >= fileSize ? fileSize : chunkSize,
            totalChunks = Math.ceil(fileSize / chunkSize),
            chunk;

        while (startBytes < fileSize) {
            chunk = this._getChunk(file, startBytes, endBytes);
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
    },
    _getChunk: function(file, startByte, endByte) {
        if (file.slice) {
            return file.slice(startByte, endByte);
        }
        else if (file.mozSlice) {
            return file.mozSlice(startByte, endByte);
        }
        else if (file.webkitSlice) {
            return file.webkitSlice(startByte, endByte);
        }
    },
    _getXhr: function(id) {
        return this._xhrs[id] = new XMLHttpRequest();
    },
    _getReadyStateChangeHandler: function(id, xhr) {
        var self = this;

        return function() {
            if (xhr.readyState === 4) {
                self._onComplete(id, xhr);
            }
        };
    },
    _setParamsAndGetEntityToSend: function(params, xhr, fileOrBlob, id) {
        var formData = new FormData(),
            protocol = this._options.demoMode ? "GET" : "POST",
            url = this._options.endpoint,
            name = this.getName(id);

        params[this._options.uuidParamName] = this._uuids[id];

        //build query string
        if (!this._options.paramsInBody) {
            params[this._options.inputName] = name;
            url = qq.obj2url(params, this._options.endpoint);
        }

        xhr.open(protocol, url, true);
        if (this._options.forceMultipart || this._options.paramsInBody) {
            if (this._options.paramsInBody) {
                qq.obj2FormData(params, formData);
            }

            formData.append(this._options.inputName, fileOrBlob);
            return formData;
        }

        return fileOrBlob;
    },
    _setHeaders: function(id, xhr) {
        var extraHeaders = this._options.customHeaders,
            name = this.getName(id),
            forceMultipart = this._options.forceMultipart,
            paramsInBody = this._options.paramsInBody,
            file = this._files[id];

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
    },
    _onComplete: function(id, xhr){
        "use strict";
        // the request was aborted/cancelled
        if (!this._files[id]) { return; }

        var name = this.getName(id);
        var size = this.getSize(id);
        var response; //the parsed JSON response from the server, or the empty object if parsing failed.

        if (!this._options.chunking.enabled || this._remainingChunks[id].length === 1) {
            this._options.onProgress(id, name, size, size);
        }

        this.log("xhr - server response received for " + id);
        this.log("responseText = " + xhr.responseText);

        try {
            if (typeof JSON.parse === "function") {
                response = JSON.parse(xhr.responseText);
            } else {
                response = eval("(" + xhr.responseText + ")");
            }
        } catch(error){
            this.log('Error when attempting to parse xhr response text (' + error + ')', 'error');
            response = {};
        }

        if (xhr.status !== 200 || !response.success){
            if (this._options.onAutoRetry(id, name, response, xhr)) {
                return;
            }
            else {
                this._completed(id, response, xhr);
            }
        }
        else if (this._options.chunking.enabled) {
            this._onSuccessfullyCompletedChunk(id, response, xhr);
        }
        else {
            this._completed(id, response, xhr);
        }
    },
    _onSuccessfullyCompletedChunk: function(id, response, xhr) {
        var chunk = this._remainingChunks[id].shift(),
            name = this.getName(id);

        this._loaded[id] += chunk.end - chunk.start;

        if (this._remainingChunks[id].length > 0) {
            this._uploadNextChunk(id);
        }
        else {
            this._completed(id, response, xhr);
        }
    },
    _completed: function(id, response, xhr) {
        var name = this.getName(id);

        this._options.onComplete(id, name, response, xhr);
        delete this._xhrs[id];
        this._dequeue(id);
    },
    _cancel: function(id){
        this._options.onCancel(id, this.getName(id));

        delete this._files[id];
        delete this._uuids[id];

        if (this._xhrs[id]){
            this._xhrs[id].abort();
            delete this._xhrs[id];
        }

        this._remainingChunks[id] = [];
    }
});
