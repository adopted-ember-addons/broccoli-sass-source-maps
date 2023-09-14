var path = require('path');
var includePathSearcher = require('include-path-searcher');
var CachingWriter = require('broccoli-caching-writer');
var fs = require('fs');
var rsvp = require('rsvp');

module.exports = function(sass) {
  SassCompiler.prototype = Object.create(CachingWriter.prototype);
  SassCompiler.prototype.constructor = SassCompiler;

  function SassCompiler (inputNodes, inputFile, outputFile, options) {
    if (!(this instanceof SassCompiler)) { return new SassCompiler(inputNodes, inputFile, outputFile, options); }
    if (!Array.isArray(inputNodes)) { throw new Error('Expected array for first argument - did you mean [tree] instead of tree?'); }

    options = options || {};

    CachingWriter.call(this, inputNodes, {
      annotation: options.annotation,
      cacheInclude: options.cacheInclude,
      cacheExclude: options.cacheExclude
    });

    this.inputFile = inputFile;
    this.outputFile = outputFile;
    this.useRender = false;

    if (!sass.compileAsync) {
      this.useRender = true;
      this.renderSass = rsvp.denodeify(sass.render);

      this.sassOptions = {
        importer: options.importer,
        functions: options.functions,
        indentedSyntax: options.indentedSyntax,
        omitSourceMapUrl: options.omitSourceMapUrl,
        outputStyle: options.outputStyle,
        precision: options.precision,
        quietDeps: options.quietDeps,
        sourceComments: options.sourceComments,
        sourceMap: options.sourceMap,
        sourceMapEmbed: options.sourceMapEmbed,
        sourceMapContents: options.sourceMapContents,
        sourceMapRoot: options.sourceMapRoot,
        fiber: options.fiber
      };
      return;
    }

    this.renderSass = sass.compileAsync;

    this.sassOptions = {
      importer: options.importer,
      functions: options.functions,
      indentedSyntax: options.indentedSyntax,
      omitSourceMapUrl: options.omitSourceMapUrl,
      style: options.outputStyle,
      precision: options.precision,
      quietDeps: options.quietDeps,
      sourceComments: options.sourceComments,
      sourceMap: options.sourceMap,
      sourceMapEmbed: options.sourceMapEmbed,
      sourceMapIncludeSources: options.sourceMapIncludeSources === undefined ? true : options.sourceMapIncludeSources,
      sourceMapContents: options.sourceMapContents,
      sourceMapRoot: options.sourceMapRoot,
      fiber: options.fiber
    };
  }

  /**
   * Mutates the error to include properties expected by Ember CLI.
   * See https://github.com/ember-cli/ember-cli/blob/master/docs/ERRORS.md#error-object
   * @param {Error} error
   */
  function rethrowBuildError(error) {
    if (typeof error === 'string') {
      throw new Error('[string exception] ' + error);
    } else {
      error.type = 'Sass Syntax Error';
      error.message = error.formatted || error.message;
      error.location = {
        line: error.line,
        column: error.column
      };

      throw error;
    }
  }

  SassCompiler.prototype.build = function() {
    var destFile = path.join(this.outputPath, this.outputFile);
    var sourceMapFile = this.sassOptions.sourceMap;

    if (typeof sourceMapFile !== 'string') {
      sourceMapFile = destFile + '.map';
    }

    fs.mkdirSync(path.dirname(destFile), { recursive: true });

    // old api
    if (this.useRender) {
      var sassOptions = {
        file: includePathSearcher.findFileSync(this.inputFile, this.inputPaths),
        includePaths: this.inputPaths,
        outFile: destFile
      };

      Object.assign(sassOptions, this.sassOptions);
      
      return this.renderSass(sassOptions).then(function(result) {
        var files = [
          fs.promises.writeFile(destFile, result.css)
        ];

        if (this.sassOptions.sourceMap && !this.sassOptions.sourceMapEmbed) {
          files.push(fs.promises.writeFile(sourceMapFile, result.map));
        }
        return Promise.all(files);
      }.bind(this)).catch(rethrowBuildError);
    }

    var sassOptions = {
      file: includePathSearcher.findFileSync(this.inputFile, this.inputPaths),
      loadPaths: [...this.inputPaths, process.cwd(),  path.join(process.cwd(), 'node_modules')],
      outFile: destFile
    };

    Object.assign(sassOptions, this.sassOptions);

    // new api
    return this.renderSass(sassOptions.file, sassOptions).then(function(result) {
      let sourceMapComment = '';
      if (this.sassOptions.sourceMap) {
        if (this.sassOptions.sourceMapEmbed) {
          sourceMapComment = '\n' + '/*# sourceMappingURL=data:application/json;base64,' + Buffer.from(JSON.stringify(result.sourceMap)).toString('base64') + '*/';
        } else {
          const name = sourceMapFile.replace(/\\/g, '/').split('/').slice(-1)[0];
          sourceMapComment = '\n' + '/*@ sourceMappingURL=' + name + '*/';
        }
      }
      var files = [
        fs.promises.writeFile(destFile, result.css + sourceMapComment)
      ];

      if (this.sassOptions.sourceMap && !this.sassOptions.sourceMapEmbed) {
        files.push(fs.promises.writeFile(sourceMapFile, JSON.stringify(result.sourceMap)));
      }

      return Promise.all(files);
    }.bind(this)).catch(rethrowBuildError);
  };

  return SassCompiler;
};
