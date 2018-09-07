"use strict";

let self = {};
const db = require("models/index");
const messages = require("config/response.messages");
const events = require("config/taskcard.events");
const mailService = require("services/mail.service");
const notifications = require("config/notifications.messages");
const moment = require("moment-timezone");
const trackService = require("services/track.service");

const verifyToken = function (token, userId, teamId) {
    return db.User
        .verifyToken(token)
        .then((decoded) => {
            let {user, team, role} = decoded;
            if (!decoded || !user || !team) {
                return Promise.reject(messages.jsonWebTokenError);
            }

            if (teamId && teamId.toString() !== team._id.toString()) {
                return Promise.reject(messages.isIncorrect("teamId"));
            }

            if (userId && userId.toString() !== user._id.toString()) {
                return Promise.reject(messages.isIncorrect("userId"));
            }

            return Promise.resolve();
        })
        .catch((err) => {
            return Promise.reject(err);
        });
};


self.init = function (_io) {
    self.io = _io;
    self.sockets = {};
    self.io.use((socket, next) => {

        let {teamId, userId, token, event} = socket.handshake.query;

        if (teamId && userId && token) {
            return next();
        } else if(event) {
            return next();
        }

        next(new Error("Authentication error"));

    });

    console.log("Socket Connection Ready ...");

    self.io.on("connection", (socket) => {
        let {teamId, userId, token, event } = socket.handshake.query;

        if(!event) {
            verifyToken(token, userId, teamId)
                .then(() => {
                    self.sockets[`${teamId}${userId}`] = socket._id;
                    socket.join(teamId);
                    socket.on("disconnect", () => {
                        let {teamId, userId, token} = socket.handshake.query;
                        delete self.sockets[`${teamId}${userId}`];
                    });
                })
                .catch((err) => {
                    socket.disconnect();
                });
        }

        // events

        if(teamId && userId && token) {
            socket.on("addNewComment", (data) => {
                let {teamId, userId} = socket.handshake.query;
                let {taskId, message, attachments, timezone} = data;

                let comment = new db.Comment({
                    task: taskId,
                    user: userId,
                    message: message || "",
                    attachments: attachments || [],
                    createdAt: moment.tz(new Date(), timezone).valueOf()
                });

                db.Task
                    .findByIdAsync(taskId)
                    .then((task) => {
                        if (task) {
                            return Promise.all([
                                comment.saveAsync(),
                                db.Task.findByIdAndUpdateAsync(comment.task, {$push: {comments: comment._id}})
                            ])
                                .then((result) => {
                                    let comment = result[0];

                                    return mailService
                                        .sendTaskCommentEmail(userId, task._id, comment._id, socket.request.headers.origin, teamId)
                                        .then((result) => {
                                            return Promise.resolve(comment._id);
                                        })
                                        .catch((err) => {
                                            return Promise.reject(err);
                                        });
                                })
                                .catch((err) => {
                                    return Promise.reject(err);
                                });
                        } else {
                            return Promise.reject(messages.isNotFound("task"));
                        }
                    })
                    .then((commentId) => {
                        return db.Comment
                            .findById(commentId)
                            .select("_id message user task attachments createdAt")
                            .populate("user", "_id firstname lastname displayPicture username")
                            .populate("attachments", "_id originalName url fileType fileName type")
                            .execAsync();
                    })
                    .then((_comment) => {
                        self.io.to(teamId).emit("notification", notifications.newComment);
                        self.io.to(teamId).emit("newCommentAdded", _comment);
                    })
                    .catch((err) => {
                        console.log(err);
                    });
            });


            socket.on("trackEvent", (data) => {

                let {teamId, userId} = socket.handshake.query;

                trackService
                    .identify(userId, teamId)
                    .then(() => {
                        let eventType = data.type;
                        return trackService.trackEvent({ userId, teamId }, eventType, data);
                    })
                    .then((segmentData) => {
                        console.log("Event successfully tracked.");
                        let rawEmitterName = data.userFullName || data.editorFullName;
                        let emmitterName = events.editEventEmitterName(rawEmitterName);

                        switch(segmentData.type) {
                            case("add_new_task"): {
                                console.log(segmentData);
                                self.io.emit(segmentData.type, segmentData);
                                break;
                            } 
                            case("delete_task"): {
                                self.io.emit(segmentData.type, segmentData);
                                break;
                            } 
                            case("view_existing_task"): {
                                return db.Task.findByIdAndUpdateAsync(data.taskId, {
                                    $push: {"usersNotified.users": userId}
                                })
                                .then(() => {
                                    self.io.emit(segmentData.type, segmentData);
                                })
                            } 
                            case("add_comment"): {
                                let eventMessage = events.commentAdded;
                                if(data.numberOfAttachments) {
                                    eventMessage = events.fileAttached;
                                }
                                return db.Task.findByIdAndUpdateAsync(data.taskId, {
                                    
                                    $set: {"usersNotified.users": [userId], "usersNotified.event": `${emmitterName} ${eventMessage}`}
                                })
                                .then(() => {
                                    self.io.emit(segmentData.type, segmentData);
                                })
                            }
                            case("edit_task"): {
                                return db.Task.findByIdAndUpdateAsync(data.taskId, {
                                    $set: {"usersNotified.users": [userId], "usersNotified.event": `${emmitterName} ${events.taskUpdated}`}
                                })
                                .then(() => {
                                    self.io.emit(segmentData.type, segmentData);
                                })
                            }
                            case("mark_task_in_progress"): {
                                return db.Task.findByIdAndUpdateAsync(data.taskId, {
                                    $set: {"usersNotified.users": [userId], "usersNotified.event": `${emmitterName} ${events.statusInProgress}`}
                                })
                                .then(() => {
                                    self.io.emit(segmentData.type, segmentData);
                                })
                            }
                            case("mark_task_todo"): {
                                return db.Task.findByIdAndUpdateAsync(data.taskId, {
                                    $set: {"usersNotified.users": [userId], "usersNotified.event": `${emmitterName} ${events.statusToDo}`}
                                })
                                .then(() => {
                                    self.io.emit(segmentData.type, segmentData);
                                })
                            }
                            case("mark_task_completed"): {
                                return db.Task.findByIdAndUpdateAsync(data.taskId, {
                                    $set: {"usersNotified.users": [userId], "usersNotified.event": `${emmitterName} ${events.taskCompleted}`}
                                })
                                .then(() => {
                                    self.io.emit(segmentData.type, segmentData);
                                })
                            }
                        }
                    })
                    .catch((err) => {
                        console.log(err);
                    });
            });
        }
    });
};

module.exports = self;