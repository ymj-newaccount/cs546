//DOM API 

//grab elemenets
let mapDiv = document.getElementById('map');
let filterAccessible = document.getElementById("filter-accessible");
let filterElevators = document.getElementById("filter-elevators");
let filterAPS = document.getElementById("filter-aps");
let filterRamps = document.getElementById("filter-ramps");
let list = document.getElementById("location-list");
let status = document.getElementById("status");
let errorDiv = document.getElementById("error");
//helper to show errors
function displayError(message)
{
    if(errorDiv)
    {
        errorDiv.hidden = false;
        errorDiv.innerHTML = "Error: " + message;
    }
}
//helper to clear errors
function clearError()
{
    if(errorDiv)
    {
        errorDiv.hidden = true;
        errorDiv.innerHTML = "";
    }
}
//helper to get map with current filters
//helper to update list view
if(mapDiv)
{
    //initialize leaflet map
    let map = L.map("map").setView([40.7128, -74.0060], 12);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        {
            maxZoom: 20,
            attribution: '© OpenStreetMap contributors'
        }).addTo(map);
    //GeoJSON layer for all features 
    let markersLayer = L.geoJson(null, {
        onEachFeature: function(feature, layer)
        {
            let p = feature.properties;
            let popupText = "";
            if(p.kind === "station")
            {
                let routesText = "";
                if(Array.isArray(p.routes))
                {
                    routesText = p.join(', ');
                }
                else if(typeof p.routes ==="string")
                {
                    routesText = p.routes;
                }
                popupText = "<strong>" + p.name + "</strong><br>" +
                "Station ID: " + p.stationId + "<br>" + 
                "Accessible: " + p.adaStatus + "<br>" +
                "Routes: " + routesText;

                //Elevators if checked
                if(p.elevators && p.elevators.length > 0)
                {
                    popupText += "<br><strong>Elevators:</strong><br>";
                    for(let i = 0; i < p.elevators.length; i++)
                    {
                        let e = p.elevators[i];
                        popupText += "<br> ID" + e.elevatorId + " - " +  e.status +
                        '(Updated: ' + e.lastUpdated + ")" + "<br>"
                    }
                }
            }
            else if(p.kind === "aps")
            {
                popupText = "<strong>Accessible Pedestrian Signal</strong><br>" +
                (p.intersection || "Unknown Intersection")

            }
            else if(p.kind === "ramp")
            {
                //To DO

            }
            else
            {
                //To DO

            }
            layer.bindPopup(popupText);
        }
    }).addTo(map);

    //attach event listeners
    //load
}
else
{
    displayError("Map information not found.");
}