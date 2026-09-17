process.env.NODE_ENV = 'test';
process.env.SYNCWATCH_TEST_MODE = 'true';

import { after } from 'node:test';
import { httpServer, io } from '../src/server.js';

import './foundation.test.js';
import './room.test.js';
import './media.test.js';
import './permission.test.js';
import './chat.test.js';
import './reaction.test.js';
import './presence.test.js';
import './webrtc.test.js';

after(async () => {
  if (httpServer.listening) {
    await new Promise((resolve) => {
      io.close(() => {
        httpServer.close(resolve);
      });
    });
  }
});

