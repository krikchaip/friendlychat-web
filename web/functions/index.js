/**
 * Copyright 2017 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child-process-promise');

// Import the Firebase SDK for Google Cloud Functions.
const functions = require('firebase-functions');

// Import and initialize the Firebase Admin SDK.
const firebase = require('firebase-admin');
firebase.initializeApp();

// Google Cloud Vision Client Library
const Vision = require('@google-cloud/vision');
const vision = new Vision();

// Adds a message that welcomes new users into the chat.
// ! https://stackoverflow.com/questions/57576674/firebase-trigger-function-ignored-due-to-missing-firebaseauth-googleapis-com-em
exports.addWelcomeMessages = functions.auth.user().onCreate(async (user) => {
  console.log('A new user signed in for the first time.');

  const fullName = user.displayName || 'Anonymous';

  // Saves the new welcome message into the database
  // which then displays it in the FriendlyChat clients.
  await firebase.firestore().collection('messages').add({
    name: 'Firebase Bot',
    profilePicUrl: '/images/firebase-logo.png', // Firebase logo
    text: `${fullName} signed in for the first time! Welcome!`,
    timestamp: firebase.firestore.FieldValue.serverTimestamp(),
  });

  console.log('Welcome message written to database.');
});

// Checks if uploaded images are flagged as Adult or Violence and if so blurs them.
exports.blurOffensiveImages =
  functions.runWith({ memory: '2GB' }).storage.object().onFinalize(async object => {
    const image = {
      source: { imageUri: `gs://${object.bucket}/${object.name}` },
    };

    // Check the image content using the Cloud Vision API.
    const batchAnnotateImagesResponse = await vision.safeSearchDetection(image);
    const safeSearchResult = batchAnnotateImagesResponse[0].safeSearchAnnotation;
    const Likelihood = Vision.types.Likelihood;

    if (Likelihood[safeSearchResult.adult] >= Likelihood.LIKELY ||
        Likelihood[safeSearchResult.violence] >= Likelihood.LIKELY) {
      console.log('The image', object.name, 'has been detected as inappropriate.');
      return blurImage(object.name);
    }

    console.log('The image', object.name, 'has been detected as OK.');
  });

// TODO(DEVELOPER): Write the sendNotifications Function here.

// Blurs the given image located in the given bucket using ImageMagick.
async function blurImage(filePath) {
  const tempLocalFile = path.join(os.tmpdir(), path.basename(filePath));
  const messageId = filePath.split(path.sep)[1];
  const bucket = firebase.storage().bucket();

  // Download file from bucket.
  await bucket.file(filePath).download({destination: tempLocalFile});
  console.log('Image has been downloaded to', tempLocalFile);

  // Blur the image using ImageMagick.
  await spawn('convert', [tempLocalFile, '-channel', 'RGBA', '-blur', '0x24', tempLocalFile]);
  console.log('Image has been blurred');

  // Uploading the Blurred image back into the bucket.
  await bucket.upload(tempLocalFile, {destination: filePath});
  console.log('Blurred image has been uploaded to', filePath);

  // Deleting the local file to free up disk space.
  fs.unlinkSync(tempLocalFile);
  console.log('Deleted local file.');

  // Indicate that the message has been moderated.
  await firebase.firestore().collection('messages').doc(messageId).update({moderated: true});
  console.log('Marked the image as moderated in the database.');
}
