/**
 * Class for uploading files, uploading itself is handled by child classes
 */
/*globals qq*/
/*jslint white: true*/
qq.UploadHandler = function(o) {
    "use strict";

    var queue = [],
        options, log, dequeue, handlerImpl;

    // Default options, can be overridden by the user
    options = {
        debug: false,
        endpoint: '/upload.php',
        paramsInBody: false,
        maxConnections: 3, // maximum number of concurrent uploads
        uuidParamName: 'qquuid',
        chunking: {
            enabled: false,
            partSize: 2000000,
            paramNames: {
                partNumber: 'qqpartnum',
                partByteOffset: 'qqpartbyteoffset',
                chunkSize: 'qqchunksize',
                totalFileSize: 'qqtotalfilesize',
                totalParts: 'qqtotalparts',
                filename: 'qqfilename'
            }
        },
        log: function(str, level) {},
        onProgress: function(id, fileName, loaded, total){},
        onComplete: function(id, fileName, response, xhr){},
        onCancel: function(id, fileName){},
        onUpload: function(id, fileName){},
        onUploadChunk: function(id, fileName, chunkData){},
        onAutoRetry: function(id, fileName, response, xhr){}

    };
    qq.extend(options, o);

    log = options.log;

    if (qq.isXhrUploadSupported()) {
        handlerImpl = new qq.UploadHandlerXhr(options, dequeue, log);
    }
    else {
        handlerImpl = new qq.UploadHandlerForm(options, dequeue, log);
    }

    /**
     * Removes element from queue, starts upload of next
     */
    dequeue = function(id) {
        var i = qq.indexOf(queue, id),
            max = options.maxConnections,
            nextId;

        queue.splice(i, 1);

        if (queue.length >= max && i < max){
            nextId = queue[max-1];
            handlerImpl.upload(nextId);
        }
    };

    return {
        /**
         * Adds file or file input to the queue
         * @returns id
         **/
        add: function(file){
            return handlerImpl.add(file);
        },
        /**
         * Sends the file identified by id
         */
        upload: function(id){
            var len = queue.push(id);

            // if too many active uploads, wait...
            if (len <= options.maxConnections){
                return handlerImpl.upload(id);
            }
        },
        retry: function(id) {
            var i = qq.indexOf(queue, id);
            if (i >= 0) {
                return handlerImpl.upload(id);
            }
            else {
                return this.upload(id);
            }
        },
        /**
         * Cancels file upload by id
         */
        cancel: function(id){
            log('Cancelling ' + id);
            options.paramsStore.remove(id);
            handlerImpl.cancel(id);
            dequeue(id);
        },
        /**
         * Cancels all uploads
         */
        cancelAll: function(){
            qq.each(queue, function(idx, fileId) {
                this.cancel(fileId);
            });

            queue = [];
        },
        /**
         * Returns name of the file identified by id
         */
        getName: function(id){
            return handlerImpl.getName(id);
        },
        /**
         * Returns size of the file identified by id
         */
        getSize: function(id){
            return handlerImpl.getSize(id);
        },
        /**
         * Returns id of files being uploaded or
         * waiting for their turn
         */
        getQueue: function(){
            return queue;
        },
        reset: function() {
            log('Resetting upload handler');
            queue = [];
            handlerImpl.reset();
        },
        getUuid: function(id) {
            return handlerImpl.getUuid(id);
        },
        /**
         * Determine if the file exists.
         */
        isValid: function(id) {
            return handlerImpl.isValid(id);
        }
    };
};
