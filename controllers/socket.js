
module.exports = {
	playing: (req, res, next) => {
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
}