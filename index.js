#!/usr/bin/env node
const fs = require("fs");
const MemoryFs = require("memory-fs");
const webpack = require("webpack");
const Dotenv = require("dotenv-webpack");
const program = require("commander");
const path = require("path");

const BUILD_FCM_FILE_PATH = "build/firebase-messaging-sw.js";
const BUILD_SW_FILE_PATH = "build/service-worker.js";
const BUNDLE_FILE_NAME = "bundle.js";

/**
 * Command line options
 */
program
  .arguments("<file>")
  .option("-s, --skip-compile", "skip compilation")
  .option(
    "-e, --env [path]",
    "path to environment variables files [./.env]",
    "./.env"
  )
  .option(
    "-t, --type <type>",
    "output type [sw|fcm]",
    /^(sw|fcm)$/i
  )
  .option(
    "-m, --mode <mode>",
    "output mode [dev|build|replace]",
    /^(dev|build|replace)$/i
  )
  .action(function(file) {
    if (program.mode === "dev") {
      process.env.BABEL_ENV = "development";
      process.env.NODE_ENV = "development";
    } else {
      process.env.BABEL_ENV = "production";
      process.env.NODE_ENV = "production";
    }

    if (program.skipCompile) {
      read(file).then(result => append(result, file));
    } else {
      compile(file).then(({ result, stats }) => append(result, file));
    }
  })
  .parse(process.argv);

/**
 * Compile entry file using WebPack
 *
 * @param {String} entry Path to entry file
 * @returns {Promise}
 */
function compile(entry) {
  // copy all 'REACT_APP_*' env vars into an env object (that will be passed to webpack)
  // CHECK: confirm that JSON.stringify() mirror's the default approach CRA uses to that
  //        the use will match
  const env = Object.keys(process.env)
                    .filter(key => !!key.match(/^REACT_APP_/))
                    .reduce((o, key) => {
                      o[`process.env.${key}`] = JSON.stringify(process.env[key]);
                      return o;
                    }, {});

  const compiler = webpack({
    mode: program.mode === "dev" ? "development" : "production",
    entry: [entry],
    output: {
      filename: BUNDLE_FILE_NAME,
      path: "/"
    },
    module: {
      rules: [
        {
          test: /\.js$/,
          exclude: /(node_modules|bower_components)/,
          use: {
            loader: "babel-loader",
            options: {
              presets: [
                [
                  "react-app",
                  {
                    targets: {
                      browsers: ["defaults"]
                    }
                  }
                ]
              ],
              plugins: ["@babel/plugin-transform-runtime"]
            }
          }
        }
      ]
    },
    plugins: [
      // default to any 'REACT_APP_*' env variables and override with any .env vars
      new webpack.DefinePlugin(env),
      new Dotenv({
        path: program.env, // Path to .env file (this is the default)
        safe: false, // load .env.example (defaults to "false" which does not use dotenv-safe)
        silent: true
      })
      // new webpack.optimize.UglifyJsPlugin()
    ]
  });

  compiler.outputFileSystem = new MemoryFs();

  return new Promise((resolve, reject) => {
    compiler.run((err, stats) => {
      if (err) return reject(err);

      if (stats.hasErrors() || stats.hasWarnings()) {
        return reject(
          new Error(
            stats.toString({
              errorDetails: true,
              warnings: true
            })
          )
        );
      }

      const result = compiler.outputFileSystem.data[
        BUNDLE_FILE_NAME
      ].toString();
      resolve({ result, stats });
    });
  });
}

/**
 * Read entry file
 *
 * @param {String} entry Path to entry file
 * @returns {Promise}
 */
function read(entry) {
  return new Promise((resolve, reject) => {
    fs.readFile(entry, "utf8", (error, result) => {
      if (error) {
        reject(error);
      }

      resolve(result);
    });
  });
}

/**
 * Append custom code to exisitng ServiceWorker or replace it entirely
 *
 * @param {String} code
 * @returns {Promise}
 */
function append(code, file) {
  if (program.mode === "dev") {
    const filename = path.basename(file);
    return writeFile(code, `public/${filename}`);
  } else if (program.mode === "build") {
    const filename = path.basename(file);
    return writeFile(code, `build/${filename}`);
  } else if (program.mode === "replace") {
    const filename = (program.type === "fcm") ? BUILD_FCM_FILE_PATH : BUILD_SW_FILE_PATH/*default*/;
    return writeFile(code, filename);
  } else {
    // Append to file based on 'type'
    const filename = (program.type === "fcm") ? BUILD_FCM_FILE_PATH : BUILD_SW_FILE_PATH/*default*/;
    return new Promise((resolve, reject) => {
      // Read exisitng file
      fs.readFile(filename, "utf8", (error, data) => {
        if (error) {
          reject(error);
        }

        // append custom code
        const result = data + code;

        // Write modified file
        fs.writeFile(filename, result, "utf8", error => {
          if (error) {
            reject(error);
          }

          resolve();
        });
      });
    });
  }
}

function writeFile(content, file) {
  return new Promise((resolve, reject) => {
    fs.writeFile(file, content, "utf8", error => {
      if (error) {
        reject(error);
      }
      resolve();
    });
  });
}
