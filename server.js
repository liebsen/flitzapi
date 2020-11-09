const fs = require('fs')
var express = require('express')
var path = require('path')
var app = express()
var cors = require('cors')
var http = require('http').Server(app)
var io = require('socket.io')(http, { origins: '*:*', pingInterval: 15000})
var moment = require('moment')
var mongodb = require('mongodb')
const bcrypt = require('bcrypt')
var expressLayouts = require('express-ejs-layouts')
var bodyParser = require('body-parser')
var EloRating = require('elo-rating')
var onlinewhen = moment().utc().subtract(10, 'minutes')
var gamesort = {date:-1}
var groups = {}
var games = {}
var movecompensation = 2
var ObjectId = require('mongodb').ObjectId
const mongo_url = process.env.MONGO_URL
const tokenExpires = 86400 * 30 * 12 // 1 year
const saltRounds = 10
var allowedOrigins = [
  'http://localhost:4000',
  'http://localhost:8080',
  'http://192.168.2.13:8080',
  'https://flitz.herokuapp.com',
  'https://flitzapi.herokuapp.com'
]

var playing = () => {
  let total = 0
  let playing = 0
  for (var i in groups) {
    total += Object.keys(groups[i].players).length
    for (var j in groups[i].players) {
      if (groups[i].players[j].plying) {
        playing++
       }
    }
  }

  return {
    idle: (total - playing), 
    playing: playing
  }
}

app.use(cors({
  origin: function(origin, callback){
    if(!origin) return callback(null, true)
    if(allowedOrigins.indexOf(origin) === -1){
      var msg = 'The CORS policy for this site does not ' +
                'allow access from the specified Origin.'
      return callback(new Error(msg), false)
    }
    return callback(null, true)
  }
}))

app.use(function(req, res, next) {
  res.header("Access-Control-Allow-Origin", "*") // update to match the domain you will make the request from
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept")
  next()
})

app.use(bodyParser.urlencoded({ extended: false }))
app.use(bodyParser.json({ type: 'application/json' }))
app.set('views', path.join(__dirname, 'static'))
app.use(express.static(path.join(__dirname, 'static')))
app.set('view engine', 'ejs')
app.use(expressLayouts)

mongodb.MongoClient.connect(mongo_url, { useUnifiedTopology: true, useNewUrlParser: true }, function(err, database) {
  if(err) throw err

  const db = database.db(mongo_url.split('/').reverse()[0])

  app.get('/', function (req, res) {
    res.render('index')
  })

  app.post('/register', function (req, res) { 
    let password = req.body.password
    if (!password) {
      return res.json({ status: 'error', message: 'no_password_given'})
    }

    bcrypt.hash(password, saltRounds, function (err, hash) {
      db.collection('accounts').findOneAndUpdate({
        _id: new ObjectId(req.body._id)
      },
      {
        "$set": {
          code: req.body.code,
          password: hash,
          email: req.body.email,
          updatedAt: moment().utc().format()
        }
      },{ 
        upsert: true, 
        'new': true, 
        returnOriginal:false 
      }).then(function(data) {
        return res.json(data.value)
      })
    })
  })

  app.post('/group/create', function (req, res) { 
    const doc = {
      code: req.body.code,
      owner: req.body.owner,
      games: req.body.games,
      minutes: req.body.minutes,
      compensation: req.body.compensation,
      date: moment().utc().format('YYYY.MM.DD HH:mm'),
      broadcast: true,
      chat: [],
      results: [],
      users: 1
    }

    db.collection('groups').insertOne(doc,function (err, response) {
      if(err){ 
        console.log(err)
        return res.json({ status: 'error', message: 'Could not create group'})
      } else {
        return res.json({ status: 'success', data: response.ops[0]})
      }
    })
  })

  app.get('/test', function (req, res) {
    let data = {
      game: 'aaaa',
      white: 'white',
      score: '1'
    }

    let $push_query = []
    $push_query.push(data)
    db.collection('groups').findOneAndUpdate(
    {
      '_id': new ObjectId('5eac96b9e527116c43355408')
    }, {
      "$push": { results: { '5eac' : { "$each" : $push_query } }  }
    }, {
      upsert: true, 
      'new': true, 
      returnOriginal:false 
    }).then(function(doc){
      return res.json('ok')
    })
  })

  app.post('/account', function (req, res) { 
    var id = req.body._id
    delete req.body._id
    req.body.updatedAt = moment().utc().format()      
    return db.collection('accounts').findOneAndUpdate(
      {
        '_id': new ObjectId(id)
      },
      {
        "$set": req.body
      },
      { 
        upsert: true, 
        'new': true, 
        returnOriginal:false 
      }).then(function(doc){
        return res.json({ status: 'success', data: doc.value})
        //io.emit('group_changed', match)
      }
    )
  })

  app.post('/group/update', function (req, res) { 
    var id = req.body.id
    var $set = {}
    for(var i in req.body){
      $set[i] = req.body[i]
    }

    $set.updatedAt = moment().utc().format()      
    delete $set.id 

    return db.collection('groups').findOneAndUpdate(
    {
      '_id': new ObjectId(id)
    },
    {
      "$set": $set
    },{ new: true }).then(function(doc){
      return res.json({ status: 'success', data: doc.value})
      //io.emit('group_changed', match)
    })
  })

  app.post('/game/create', function (req, res) { 
    const doc = {      
      event: req.body.event,
      white: req.body.white,
      black: req.body.black,
      whiteflag: req.body.whiteflag,
      blackflag: req.body.blackflag,
      whiteelo: req.body.whiteelo,
      blackelo: req.body.blackelo,
      minutes: req.body.minutes,
      games: req.body.games,
      game: req.body.game,
      compensation: req.body.compensation,
      date:moment().utc().format('YYYY.MM.DD HH:mm'),
      broadcast: true,
      views: 0
    }

    db.collection('games').insertOne(doc,function (err, response) {
      if(err){ 
        console.log(err)
        return res.json({ status : 'error', message : 'Could not create game'})
      } else {
        return res.json({ status : 'success', data: response.ops[0]})
      }
    })
  })

  app.post('/game/save', function (req, res) { 
    let body = req.body
    body.site = 'Flitz'
    body.date = moment().format('YYYY.MM.DD HH:mm')
    body.views = 0
    db.collection('games').insertOne(body, (err, response) => {
      if(err){ 
        console.log(err)
        return res.json({ status : 'error', message : 'Could not create game'})
      } else {
        return res.json({ status : 'success', data: response.ops[0]})
      }
    })
  })

  app.post('/game', function (req, res) {
    if (!req.body.id) {
      return res.json({ status: 'error', message: 'error_game_nep' })
    }
    let id = req.body.id
    var data = {}
    db.collection('games').find({
      '_id': new ObjectId(id)
    }).toArray((err, docs) => {
      if(docs[0]){
        data = docs[0]
        db.collection('games')
          .find({_id: {$gt: data._id}})
          .sort({_id: 1 })
          .limit(1)
          .toArray((err, next) => {
            if (next[0]) {
              data.next = next[0]._id
            }
            db.collection('games')
              .find({_id: {$lt: data._id}})
              .sort({_id: -1 })
              .limit(1)
              .toArray((err, prev) => {
                if (prev[0]) {
                  data.prev = prev[0]._id
                }
                return res.json(data)
              })
          })
      }
    })
  })

  app.post('/group', function (req, res) {
    let dateLimit = moment().subtract(14, 'days')
    db.collection('groups').find({
      '_id': new ObjectId(req.body.id)
    }).toArray(function(err,docs){
      var data = {}
      if(docs[0]){
        data = docs[0]
        data.chat = data.chat ? data.chat.filter(e => moment(e.created).format('x') > dateLimit) : []
        data.results = data.results ? data.results.filter(e => moment(e.date, 'YYYY.MM.DD').format('x') > dateLimit) : []
      }
      return res.json(data)
    })
  })

  app.post('/playlist', function (req, res) {
    var $or = []
    var limit = 5
    var offset = 0

    for (var i in req.body) {
      $or.push({'black': {'$regex' : req.body.black, '$options' : 'i'}})
      $or.push({'white': {'$regex' : req.body.white, '$options' : 'i'}})
      $or.push({'black': {'$regex' : req.body.white, '$options' : 'i'}})
      $or.push({'white': {'$regex' : req.body.black, '$options' : 'i'}})
    }

    db.collection('games').find({"$or": $or})
      .sort(gamesort)
      .limit(limit)
      .skip(offset)
      .toArray((err, docs) => {
        return res.json(docs)
      })   
  })

  app.post('/gamecount', function (req, res) { 
    db.collection('games').find(req.body).toArray(function(err,docs){
      return res.json(docs.length)
    })
  })

  app.post('/eco/search', function (req, res) { 
    var limit = parseInt(req.body.limit)||25
    , offset = parseInt(req.body.offset)||0
    , query = unescape(req.body.query)

    let $find = {"pgn" : { $exists: true, $ne: null }}

    if(query.length){
      $find.$or = []
      if(query.match(/^(\d)\. /g)) {
        $find.$or.push({"pgn": {'$regex' : query, '$options' : 'i'}})
      } else {
        $find.$or.push({"eco": {'$regex' : query, '$options' : 'i'}})
        $find.$or.push({"name": {'$regex' : query, '$options' : 'i'}})
      }
    }

    db.collection('eco').countDocuments($find, function(error, numOfDocs){
      db.collection('eco').find($find)
        .sort({name:1})
        .limit(limit)
        .skip(offset)
        .toArray(function(err,docs){
          return res.json({games:docs,count:numOfDocs})
        })   
    })
  })

  app.post('/eco/search/pgn', function (req, res) { 
    db.collection('eco').find({
      pgn: req.body.pgn
    }).toArray(function(err,docs){
      return res.json(docs[0])
    })
  })

  app.post('/eco/pgn', function (req, res) { 
    db.collection('eco').find({
      pgn: new RegExp('^' + req.body.pgn, 'i')
    }).toArray(function(err,docs){
      return res.json(docs[0])
    })
  })

  app.post('/eco/pgn/random', function (req, res) { 
    db.collection('eco').aggregate([
      {
        "$redact": {
            "$cond": [
                { "$lt": [ { "$strLenCP": "$pgn" }, 20] },
                "$$KEEP",
                "$$PRUNE"
            ]
        }
      },
      { $sample: { size: 1 } }
      ]).toArray(function(err,docs){
      return res.json(docs[0])
    })
  })

  app.post('/group/random', function (req, res) { 
    db.collection('groups').aggregate([
      { "$match" : { "broadcast": true } },
      { "$project" : { code: 1, games: 1, minutes: 1, compensation: 1, users: 1 } },
      {
        "$redact": {
            "$cond": [
                { 
                  "$lt": [ { "$strLenCP": "code" }, 20]
                },
                "$$KEEP",
                "$$PRUNE"
            ]
        }
      },
      { $sample: { size: 9 } }
      ]).toArray(function(err,docs) {
        if (docs) {
          return res.json({ status: 'success', data: docs })
        } else {
          return res.json({ status: 'error' })
        }
    })
  })

  app.post('/search', function (req, res) { 
    var limit = parseInt(req.body.limit)||25
    , offset = parseInt(req.body.offset)||0
    , query = unescape(req.body.query).trim()
    , strict = unescape(req.body.strict).trim()

    let $find = {"pgn" : { $exists: true, $ne: null }}
    if(query.length){
      $find.$or = []
      if(query.match(/^(\d)\. /g)) {
        $find.$or.push({"pgn": {'$regex' : query, '$options' : 'i'}})
      } else {
        if (strict === '1') {
          $find.$or.push({"white": query})
          $find.$or.push({"black": query})
        } else {
          if (query.indexOf(' ') === -1 && query.length > 15) {
            $find.$or.push({"group": query})
          } else {
            $find.$or.push({"date": {'$regex' : query, '$options' : 'i'}})        
            query.split(' ').forEach((word) => {
              $find.$or.push({"white": {'$regex' : word, '$options' : 'i'}})
              $find.$or.push({"black": {'$regex' : word, '$options' : 'i'}})
              $find.$or.push({"event": {'$regex' : word, '$options' : 'i'}})
              $find.$or.push({"site": {'$regex' : word, '$options' : 'i'}})
            }) 
          }
        }
      }
    }

    db.collection('games').countDocuments($find, function(error, numOfDocs){
      db.collection('games').find($find)
        .sort(gamesort)
        .limit(limit)
        .skip(offset)
        .toArray(function(err,docs){
          return res.json({games:docs,count:numOfDocs})
        })   
    })
  })

  app.post('/dash/search', function (req, res) { 
    var limit = parseInt(req.body.limit)||25
    , offset = parseInt(req.body.offset)||0
    , query = unescape(req.body.query).trim()
    , code = unescape(req.body.code).trim()
    , strict = unescape(req.body.strict).trim()

    let $find = {}

    $find.$or = []
    $find.$or.push({"white": code})
    $find.$or.push({"black": code})

    if(query.length){
      $find.$or.push({"white": code})
      $find.$or.push({"black": code})
      $find.$or.push({"white": query})
      $find.$or.push({"black": query})
    }

    db.collection('games').countDocuments($find, function(error, numOfDocs){
      db.collection('games').find($find)
        .sort(gamesort)
        .limit(limit)
        .skip(offset)
        .toArray(function(err,docs){
          return res.json({games:docs,count:numOfDocs})
        })   
    })
  })

  app.post('/online', function (req, res) { 

    var $or = []
    , limit = parseInt(req.body.limit)||25
    , offset = parseInt(req.body.offset)||0
    , query = unescape(req.body.query)

    let $find = {
      pgn : { $exists: true, $ne: null },
      updatedAt: { $gte: onlinewhen.format() },
      result: { $nin : ["0-1", "1-0", "1/2-1/2"] }
    }

    if(query.length){
      $find.$or = []
      query.split(' ').forEach((word) => {
        $find.$or.push({"white": {'$regex' : word, '$options' : 'i'}})
        $find.$or.push({"black": {'$regex' : word, '$options' : 'i'}})
        $find.$or.push({"event": {'$regex' : word, '$options' : 'i'}})
        $find.$or.push({"site": {'$regex' : word, '$options' : 'i'}})
        $find.$or.push({"date": {'$regex' : word, '$options' : 'i'}})
        $find.$or.push({"pgn": {'$regex' : word, '$options' : 'i'}})
      })
    }

    db.collection('games').countDocuments($find, function(error, numOfDocs){
      db.collection('games').find($find)
        .sort(gamesort)
        .limit(limit)
        .skip(offset)
        .toArray(function(err,docs){
          return res.json({games:docs,count:numOfDocs})
        })
    })
  })

  app.post('/groups', function (req, res) { 

    var $or = []
    , limit = parseInt(req.body.limit)||25
    , offset = parseInt(req.body.offset)||0
    , query = unescape(req.body.query)

    let $find = {
      broadcast : true
    }

    if(query.length){
      $find = {"code" : { '$regex' : query, '$options' : 'i'}}
    }

    db.collection('groups').countDocuments($find, function(error, numOfDocs){
      db.collection('groups').find($find)
        .sort({_id:-1})
        .limit(limit)
        .skip(offset)
        .toArray(function(err,docs){
          return res.json({data: docs, count:numOfDocs})
        })
    })
  })

  io.on('connection', function(socket){ //join group on connect
    socket.on('disconnect', function() {
      console.log("disconnect")
      for (var i in groups) {
        console.log('disconnect1')
        if (Object.keys(groups[i].players).length) {
          console.log('disconnect2')
          Object.keys(groups[i].players).map(j => {
            let e = groups[i].players[j]
            console.log('disconnect2')
            console.log(e)
            console.log(e.socket+' '+socket.id)
            if(e.socket === socket.id){
              console.log(`${e.code} leaves group: ${groups[i].code}`)
              delete groups[i].players[j]

              db.collection('groups').findOneAndUpdate(
              {
                '_id': new ObjectId(i)
              },
              {
                "$set": { users: Object.keys(groups[i].players).length }
              })
              io.to(i).emit('players', groups[i].players)
            }
          })
        }
      }      
    })

    socket.on('join', function(data) {
      if (data.game) {
        socket.join(data.game._id)
        if(!games[data.game._id]){
          games[data.game._id] = data
          console.log(data.game._id + " game ready to start")
        }

        // io.emit('games', games)

        for(var i in groups){
          for(var j in groups[i].players) {
            if (groups[i].players[j]._id === data.player._id) {
              groups[i].players[j].plying = true
              io.emit('joined', groups[i].players[j])
              io.to(i).emit('players', groups[i].players)
            }
          }
        }
      }
    })

    socket.on('leave', function(data) {
      socket.leave(data)
    })

    socket.on('reject', function(data) {
      io.emit('reject', data)
    })

    socket.on('resume', function(data) {
      io.emit('resume', data)
    })

    socket.on('play', function(data) {
      io.to(data.id).emit('play', data)
    })

    socket.on('invite', function(data) {
      io.emit('invite', data)
    })

    socket.on('invite_rematch', function(data) {
      io.emit('invite_rematch', data)
    })

    socket.on('reject_rematch', function(data) {
      io.emit('reject_rematch', data)
    })

    socket.on('group_chat', function(data) { //move object emitter
      let id = data.id 
      
      data.created = new Date()
      delete data.id 

      if (data.sender !== 'bot') {
        let $push_query = []
        $push_query.push(data)
        db.collection('groups').findOneAndUpdate(
        {
          _id : new ObjectId(id)
        },
        {
          "$push" : { "chat": { "$each" : $push_query } }
        },
        { 
          upsert: true, 
          'new': true, 
          returnOriginal:false 
        })
      }

      io.to(id).emit('group_chat', data)
    })

    socket.on('preferences', function(data) {
      var exists = false
      db.collection('accounts').find({
        code: data.code
      }).toArray(function(err,docs){
        data.exists = false
        if (docs) {
          data.exists = true
        }
        io.emit('player', data)
      })
    })
    
    socket.on('playing', function (data) {
      io.emit('testing', {status: 'success'})
      io.emit('playing', playing())
    })

    socket.on('find_opponent', function (data) { 
      let item = {}
      let event = 'landing'
      let id = data.group
      if (groups[id]) {
        Object.keys(groups[id].players).forEach(i => {
          let player = groups[id].players[i]
          player.socket = socket.id
          if (player.code !== data.player.code && !player.plying && !player.observe) {
            event = groups[id].code
            item = groups[id]
            item.player = player
          }
        })
      }

      if (!item._id) {
        Object.keys(groups).forEach(i => {
          Object.keys(groups[i].players).forEach(j => {
            let player = groups[i].players[j]
            player.socket = socket.id
            if (player.code !== data.player.code && player.autoaccept && !player.observe && !player.plying) {
              item = groups[i]
              item.player = player
            }
          })
        })
      }

      if (item._id) {
        let white = item.player
        let black = data.player
        let match_id = new ObjectId().toString()
        const coin = Math.floor(Math.random() * 1)

        if(coin){
          white = data.player
          black = item.player
        }

        const game = {      
          event: event,
          white: white.code,
          black: black.code,
          whiteelo: white.elo,
          blackelo: black.elo,
          whiteflag: white.flag,
          blackflag: black.flag,
          minutes: item.minutes,
          games: item.games,
          game: 1,
          group: item._id,
          compensation: item.compensation,
          date:moment().utc().format('YYYY.MM.DD HH:mm'),
          broadcast: true,
          views: 0
        }

        db.collection('games').insertOne(game,function (err, response) {
          if(err){ 
            io.emit('opponent_not_found') 
          } else {
            io.emit('game_spawn', {
              group: item._id,
              match: match_id,
              white: white.code,
              black: black.code,
              game: response.ops[0]._id
            })
          }
        })
      } else {
        io.to(socket.id).emit('opponent_not_found') 
        console.log('opponent_not_found')
      }      
    })

    socket.on('group_join', function(data) {
      if (!data.group) return false
      let id = data.group._id
      
      if (!groups[id]) {
        groups[id] = data.group
        groups[id].players = {}
      }

      if(!groups[id].players[data.player._id]) {
        data.player.socket = socket.id
        groups[id].players[data.player._id] = data.player
        console.log(`${data.player.code} joins ${groups[id].code}`)
      }

      groups[id].players[data.player._id].plying = false
      socket.join(id)
      io.to(id).emit("group_join", data.player)
      io.to(id).emit('players', groups[id].players)

      io.emit('playing', playing())

      return db.collection('groups').findOneAndUpdate(
      {
        '_id': new ObjectId(id)
      },
      {
        "$set": { users: Object.keys(groups[id].players).length }
      })
    })

    socket.on('group_leave', function(data) {
      if (!data.group) return 
      const id = data.group._id
      if (groups[id]) {
        if (groups[id].players[data.player._id]) {
          io.to(id).emit("group_leave", data.player)
          delete groups[id].players[data.player._id]
          console.log(`${data.player.code} leaves ${groups[id].code}`)
        }

        io.to(id).emit('players', groups[id].players)

        io.emit('playing', playing())

        return db.collection('groups').findOneAndUpdate(
        {
          '_id': new ObjectId(id)
        },
        {
          "$set": { users: Object.keys(groups[id].players).length }
        })
      }
    })

    socket.on('start', function(data) {
      io.to(data.id).emit('start', data)
    })

    socket.on('capitulate', function(data) {
      io.to(data.id).emit('capitulate', data)
    })

    socket.on('askfordraw', function(data) {
      io.to(data.id).emit('askfordraw', data)
    })

    socket.on('acceptdraw', function(data) {
      io.to(data.id).emit('acceptdraw', data)
    })

    socket.on('rejectdraw', function(data) {
      io.to(data.id).emit('rejectdraw', data)
    })

    socket.on('gone', function(data) {
      io.to(data.id).emit('gone', data)
    })
    
    socket.on('undo', function(data) { //undo emitter
      io.to(data.id).emit('undo', data)
    })

    socket.on('chat', function(data) { //chat object emitter
      io.to(data.id).emit('chat', data)
    })

    socket.on('move', function(data) { //move object emitter
      var id = data.id
      var item = {}
      var compensation = data.compensation||0
      for(var i in data){
        item[i] = data[i]
      }
      var t = data.turn === 'w' ? 'b' : 'w'
      data[t + 'time'] += compensation
      item[t + 'time'] = data[t + 'time']
      item.updatedAt = moment().utc().format()
      delete item.id 

      return db.collection('games').findOneAndUpdate(
      {
        '_id': new ObjectId(id)
      },
      {
        "$set": item
      },{ new: true }).then(function(doc){
        io.to(id).emit('move', data)
        io.emit('game', doc.value)
      })
    })

    socket.on('game', function(data) { //game object emitter
      var id = data._id
      var updateElo = false
      var event = ''
      data.updatedAt = moment().utc().format()
      delete data._id 

      if (!data.event) {
        if (groups[data.group]) {
          data.event = groups[data.group].code
        }
      }

      if (data.result && data.result !== '1/2-1/2') {
        updateElo = true
        var playerWin = data.result === '1-0'

        if (data.whiteelo && data.blackelo) {
          var elo = EloRating.calculate(data.whiteelo, data.blackelo, playerWin)
          data.whiteelo = elo.playerRating
          data.blackelo = elo.opponentRating
        }

        if (groups[data.group]) {
          if (groups[data.group].players[data.white]) {
            groups[data.group].players[data.white].elo = data.whiteelo
          }
          if (groups[data.group].players[data.black]) {
            groups[data.group].players[data.black].elo = data.blackelo
          }
        }
      }

      return db.collection('games').findOneAndUpdate(
      {
        '_id': new ObjectId(id)
      },
      {
        "$set": data
      },
      { 
        upsert: true, 
        'new': true, 
        returnOriginal:false 
      }).then(function(doc){
        // io.to(id).emit('data', data)
        let game = doc.value
        io.to(id).emit('game_updated', game)

        if (data.result) {
          io.emit('games', Object.keys(games).filter((e, i) => { return i !== id }))
        }

        if (updateElo) {
          let $push_query = []
          $push_query.push({
            elo: data.whiteelo,
            updateAt: new Date()
          })
          return db.collection('accounts').findOneAndUpdate({
            code: data.white,
          }, {
            "$set": {
              elo: data.whiteelo
            },
            "$push": {
              eloUpdates: { "$each": $push_query }
            }
          }).then(function(white){
            if(white.value) {
              if (groups[data.group]) {
                if (groups[data.group].players[white._id]) {
                  groups[data.group].players[white._id].elo = data.whiteelo
                }
              }
            }

            let $push_query = []
            $push_query.push({
              elo: data.blackelo,
              updateAt: new Date()
            })
            return db.collection('accounts').findOneAndUpdate({
              code: data.black,
            }, {
              "$set": {
                elo: data.blackelo
              },
              "$push": {
                eloUpdates: { "$each": $push_query }
              }
            }).then(function(black){
              if(black.value) {
                if (groups[data.group]) {
                  if (groups[data.group].players[black._id]) {
                    groups[data.group].players[black._id].elo = data.blackelo
                  }
                }
              }
            })
          })
        }
      })
    })

    socket.on('group', function(data) { //channel object emitter
      var id = data._id
      data.updatedAt = moment().utc().format()      
      delete data._id
      return db.collection('groups').findOneAndUpdate(
      {
        '_id': new ObjectId(id)
      }, {
        "$set": data
      }, {
        upsert: true, 
        'new': true, 
        returnOriginal:false 
      }).then(function(doc){
        io.to(id).emit('group_updated', doc.value)
      })
    })

    socket.on('group_result', function(data) { //channel object emitter
      var id = data._id
      data.updatedAt = moment().utc().format()      
      let $push_query = []
      $push_query.push(data.result)
      return db.collection('groups').findOneAndUpdate(
      {
        '_id': new ObjectId(id)
      }, {
        "$push" : { "results": { "$each" : $push_query } }
      }, {
        upsert: true, 
        'new': true, 
        returnOriginal:false 
      }).then(function(doc){
        io.to(id).emit('group_updated', doc.value)
      })
    })
  })


  let port = process.env.PORT||4000
  var server = http.listen(port, function () { //run http and web socket server
    console.log(`Server running at http://localhost:${port}`)
  })
})