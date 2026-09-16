process.env.NODE_ENV = 'test';
process.env.SYNCWATCH_TEST_MODE = 'true';

import './foundation.test.js';
import './room.test.js';
import './media.test.js';
import './permission.test.js';
