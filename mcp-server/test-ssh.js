import { Client } from 'ssh2';
import dotenv from 'dotenv';
dotenv.config();

const config = {
  host: process.env.HOSTINGER_HOST,
  port: 22,
  username: process.env.HOSTINGER_USER,
  // Using the provided key as 'privateKey' to test if user mistook it for private, 
  // or checking if it works as password (unlikely for RSA string).
  // Note: Standard SSH requires Private Key.
  privateKey: process.env.HOSTINGER_PASSWORD 
};

console.log(`Attempting to connect to ${config.host} as ${config.username}...`);

const conn = new Client();
conn.on('ready', () => {
  console.log('Client :: ready');
  conn.exec('uptime', (err, stream) => {
    if (err) throw err;
    stream.on('close', (code, signal) => {
      console.log('Stream :: close :: code: ' + code + ', signal: ' + signal);
      conn.end();
    }).on('data', (data) => {
      console.log('STDOUT: ' + data);
    }).stderr.on('data', (data) => {
      console.log('STDERR: ' + data);
    });
  });
}).on('error', (err) => {
    console.error('Connection Failed:', err.message);
    if (err.level === 'client-authentication') {
        console.error('Reason: Authentication Failed. You provided a PUBLIC Key, but a PRIVATE Key or Password is required.');
    }
}).connect(config);
