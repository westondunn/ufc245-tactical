#!/usr/bin/env python3
"""Generate comprehensive UFC seed.json from known fight data."""
import json

fighters = {}  # name → dict
events = []
fights = []
fight_stats_list = []

fid = 0
eid = 0
fightid = 0

def F(name, nick, h, reach, stance, wc, nat):
    """Register a fighter, return their ID."""
    global fid
    if name in fighters:
        return fighters[name]['id']
    fid += 1
    fighters[name] = {
        'id': fid, 'name': name, 'nickname': nick,
        'height_cm': h, 'reach_cm': reach, 'stance': stance,
        'weight_class': wc, 'nationality': nat
    }
    return fid

def E(num, name, date, venue, city, country='USA'):
    """Register an event, return its ID."""
    global eid
    eid += 1
    events.append({
        'id': eid, 'number': num, 'name': name,
        'date': date, 'venue': venue, 'city': city, 'country': country
    })
    return eid

def FIGHT(ev_id, red, blue, wc, title, main, pos, method, detail, rd, time, winner, ref='Herb Dean'):
    """Register a fight."""
    global fightid
    fightid += 1
    fights.append({
        'id': fightid, 'event_id': ev_id,
        'red_fighter_id': red, 'blue_fighter_id': blue,
        'weight_class': wc, 'is_title': title, 'is_main': main,
        'card_position': pos, 'method': method, 'method_detail': detail,
        'round': rd, 'time': time, 'winner_id': winner, 'referee': ref
    })
    return fightid

def STATS(fight_id, fighter_id, sl, sa, kd=0, td=0, tda=0, ctrl=0, head=0, body=0, leg=0, dist=0, clinch=0, ground=0, sub=0):
    fight_stats_list.append({
        'fight_id': fight_id, 'fighter_id': fighter_id,
        'sig_str_landed': sl, 'sig_str_attempted': sa,
        'total_str_landed': sl+10, 'total_str_attempted': sa+15,
        'takedowns_landed': td, 'takedowns_attempted': tda,
        'knockdowns': kd, 'sub_attempts': sub,
        'control_time_sec': ctrl,
        'head_landed': head or int(sl*0.6), 'body_landed': body or int(sl*0.25),
        'leg_landed': leg or int(sl*0.15),
        'distance_landed': dist or int(sl*0.65), 'clinch_landed': clinch or int(sl*0.2),
        'ground_landed': ground or int(sl*0.15)
    })

# ============================================================
# FIGHTERS (comprehensive list)
# ============================================================
# Heavyweights
stipe   = F('Stipe Miocic', 'The Silencer', 193, 203, 'Orthodox', 'Heavyweight', 'USA')
dc      = F('Daniel Cormier', 'DC', 180, 188, 'Orthodox', 'Heavyweight', 'USA')
ngannou = F('Francis Ngannou', 'The Predator', 193, 211, 'Orthodox', 'Heavyweight', 'Cameroon')
lewis   = F('Derrick Lewis', 'The Black Beast', 191, 196, 'Orthodox', 'Heavyweight', 'USA')
volkov  = F('Alexander Volkov', 'Drago', 201, 203, 'Orthodox', 'Heavyweight', 'Russia')
gane    = F('Ciryl Gane', 'Bon Gamin', 193, 203, 'Orthodox', 'Heavyweight', 'France')
jones   = F('Jon Jones', 'Bones', 193, 215, 'Orthodox', 'Heavyweight', 'USA')
blaydes = F('Curtis Blaydes', 'Razor', 193, 203, 'Orthodox', 'Heavyweight', 'USA')
overeem = F('Alistair Overeem', 'The Reem', 193, 203, 'Orthodox', 'Heavyweight', 'Netherlands')
tuivasa = F('Tai Tuivasa', 'Bam Bam', 188, 193, 'Orthodox', 'Heavyweight', 'Australia')
aspinall= F('Tom Aspinall', 'The Asp', 196, 198, 'Orthodox', 'Heavyweight', 'UK')

# Light Heavyweights
jj_lhw  = jones  # Jon Jones also LHW
dc_lhw  = dc
glover  = F('Glover Teixeira', 'The Silent Assassin', 188, 196, 'Orthodox', 'Light Heavyweight', 'Brazil')
prochazka= F('Jiri Prochazka', 'Denisa', 193, 203, 'Orthodox', 'Light Heavyweight', 'Czech Republic')
jan     = F('Jan Blachowicz', 'Prince of Cieszyn', 188, 196, 'Orthodox', 'Light Heavyweight', 'Poland')
reyes   = F('Dominick Reyes', 'The Devastator', 193, 196, 'Orthodox', 'Light Heavyweight', 'USA')
smith   = F('Anthony Smith', 'Lionheart', 193, 196, 'Orthodox', 'Light Heavyweight', 'USA')
alex_p  = F('Alex Pereira', 'Poatan', 193, 203, 'Orthodox', 'Light Heavyweight', 'Brazil')
rumble  = F('Anthony Johnson', 'Rumble', 188, 196, 'Orthodox', 'Light Heavyweight', 'USA')

# Middleweights
izzy    = F('Israel Adesanya', 'The Last Stylebender', 193, 203, 'Southpaw', 'Middleweight', 'Nigeria')
whittaker=F('Robert Whittaker', 'The Reaper', 183, 185, 'Orthodox', 'Middleweight', 'Australia')
costa   = F('Paulo Costa', 'Borrachinha', 185, 185, 'Orthodox', 'Middleweight', 'Brazil')
gastelum= F('Kelvin Gastelum', 'KG', 175, 183, 'Orthodox', 'Middleweight', 'USA')
bisping = F('Michael Bisping', 'The Count', 188, 196, 'Orthodox', 'Middleweight', 'UK')
gsp     = F('Georges St-Pierre', 'Rush', 178, 193, 'Orthodox', 'Middleweight', 'Canada')
rockhold= F('Luke Rockhold', 'Rocky', 191, 196, 'Southpaw', 'Middleweight', 'USA')
weidman = F('Chris Weidman', 'The All-American', 185, 191, 'Orthodox', 'Middleweight', 'USA')
silva   = F('Anderson Silva', 'The Spider', 188, 196, 'Orthodox', 'Middleweight', 'Brazil')
strickland=F('Sean Strickland', 'Tarzan', 185, 193, 'Orthodox', 'Middleweight', 'USA')
du_plessis=F('Dricus Du Plessis', 'Stillknocks', 180, 188, 'Southpaw', 'Middleweight', 'South Africa')
hall    = F('Uriah Hall', 'Prime Time', 185, 196, 'Southpaw', 'Middleweight', 'Jamaica')

# Welterweights
usman   = F('Kamaru Usman', 'The Nigerian Nightmare', 183, 193, 'Orthodox', 'Welterweight', 'Nigeria')
covington=F('Colby Covington', 'Chaos', 180, 183, 'Orthodox', 'Welterweight', 'USA')
masvidal= F('Jorge Masvidal', 'Gamebred', 180, 183, 'Orthodox', 'Welterweight', 'USA')
woodley = F('Tyron Woodley', 'The Chosen One', 175, 188, 'Orthodox', 'Welterweight', 'USA')
burns   = F('Gilbert Burns', 'Durinho', 178, 180, 'Orthodox', 'Welterweight', 'Brazil')
edwards = F('Leon Edwards', 'Rocky', 183, 190, 'Orthodox', 'Welterweight', 'UK')
belal   = F('Belal Muhammad', 'Remember the Name', 180, 183, 'Orthodox', 'Welterweight', 'USA')
lawler  = F('Robbie Lawler', 'Ruthless', 180, 185, 'Southpaw', 'Welterweight', 'USA')
askren  = F('Ben Askren', 'Funky', 178, 183, 'Orthodox', 'Welterweight', 'USA')
thompson= F('Stephen Thompson', 'Wonderboy', 183, 193, 'Orthodox', 'Welterweight', 'USA')

# Lightweights
khabib  = F('Khabib Nurmagomedov', 'The Eagle', 178, 178, 'Orthodox', 'Lightweight', 'Russia')
mcgregor= F('Conor McGregor', 'The Notorious', 175, 188, 'Southpaw', 'Lightweight', 'Ireland')
poirier = F('Dustin Poirier', 'The Diamond', 175, 183, 'Southpaw', 'Lightweight', 'USA')
gaethje = F('Justin Gaethje', 'The Highlight', 180, 178, 'Orthodox', 'Lightweight', 'USA')
oliveira= F('Charles Oliveira', 'Do Bronx', 178, 188, 'Orthodox', 'Lightweight', 'Brazil')
ferguson= F('Tony Ferguson', 'El Cucuy', 180, 193, 'Orthodox', 'Lightweight', 'USA')
makhachev=F('Islam Makhachev', 'The Eagle\'s Disciple', 178, 178, 'Southpaw', 'Lightweight', 'Russia')
chandler= F('Michael Chandler', 'Iron', 173, 175, 'Orthodox', 'Lightweight', 'USA')
alvarez = F('Eddie Alvarez', 'The Underground King', 175, 178, 'Orthodox', 'Lightweight', 'USA')
pettis  = F('Anthony Pettis', 'Showtime', 175, 183, 'Orthodox', 'Lightweight', 'USA')
cerrone = F('Donald Cerrone', 'Cowboy', 183, 188, 'Orthodox', 'Lightweight', 'USA')
dariush = F('Beneil Dariush', 'Benny', 178, 183, 'Orthodox', 'Lightweight', 'USA')
tsarukyan=F('Arman Tsarukyan', 'Ahalkalakets', 175, 183, 'Orthodox', 'Lightweight', 'Armenia')

# Featherweights
volk    = F('Alexander Volkanovski', 'The Great', 168, 182, 'Orthodox', 'Featherweight', 'Australia')
holloway= F('Max Holloway', 'Blessed', 180, 175, 'Orthodox', 'Featherweight', 'USA')
aldo    = F('José Aldo', 'Scarface', 170, 178, 'Orthodox', 'Featherweight', 'Brazil')
ortega  = F('Brian Ortega', 'T-City', 175, 183, 'Orthodox', 'Featherweight', 'USA')
korean  = F('Chan Sung Jung', 'The Korean Zombie', 175, 183, 'Orthodox', 'Featherweight', 'South Korea')
topuria = F('Ilia Topuria', 'El Matador', 170, 175, 'Orthodox', 'Featherweight', 'Spain')
emmett  = F('Josh Emmett', 'The Fighting Falcon', 170, 178, 'Orthodox', 'Featherweight', 'USA')
kattar  = F('Calvin Kattar', 'The Boston Finisher', 180, 183, 'Orthodox', 'Featherweight', 'USA')

# Bantamweights
yan     = F('Petr Yan', 'No Mercy', 170, 170, 'Orthodox', 'Bantamweight', 'Russia')
sterling=F('Aljamain Sterling', 'Funk Master', 170, 180, 'Orthodox', 'Bantamweight', 'USA')
dillashaw=F('TJ Dillashaw', 'Killashaw', 170, 175, 'Orthodox', 'Bantamweight', 'USA')
cejudo  = F('Henry Cejudo', 'Triple C', 163, 163, 'Orthodox', 'Bantamweight', 'USA')
garbrandt=F('Cody Garbrandt', 'No Love', 173, 170, 'Orthodox', 'Bantamweight', 'USA')
cruz    = F('Dominick Cruz', 'The Dominator', 173, 173, 'Orthodox', 'Bantamweight', 'USA')
omalley = F("Sean O'Malley", 'Sugar', 180, 183, 'Southpaw', 'Bantamweight', 'USA')
sandhagen=F('Cory Sandhagen', 'The Sandman', 180, 178, 'Orthodox', 'Bantamweight', 'USA')
merab   = F('Merab Dvalishvili', 'The Machine', 170, 175, 'Orthodox', 'Bantamweight', 'Georgia')
moraes  = F('Marlon Moraes', 'Magic', 170, 170, 'Orthodox', 'Bantamweight', 'Brazil')

# Flyweights
dj      = F('Demetrious Johnson', 'Mighty Mouse', 160, 165, 'Orthodox', 'Flyweight', 'USA')
figgy   = F('Deiveson Figueiredo', 'Deus da Guerra', 165, 170, 'Orthodox', 'Flyweight', 'Brazil')
moreno  = F('Brandon Moreno', 'The Assassin Baby', 170, 178, 'Orthodox', 'Flyweight', 'Mexico')
pantoja = F('Alexandre Pantoja', 'The Cannibal', 165, 170, 'Orthodox', 'Flyweight', 'Brazil')

# Women's
nunes   = F('Amanda Nunes', 'The Lioness', 173, 175, 'Orthodox', 'W-Bantamweight', 'Brazil')
rousey  = F('Ronda Rousey', 'Rowdy', 170, 170, 'Orthodox', 'W-Bantamweight', 'USA')
holm    = F('Holly Holm', 'The Preacher\'s Daughter', 173, 178, 'Southpaw', 'W-Bantamweight', 'USA')
shevchenko=F('Valentina Shevchenko', 'Bullet', 165, 168, 'Orthodox', 'W-Flyweight', 'Kyrgyzstan')
namajunas=F('Rose Namajunas', 'Thug Rose', 165, 165, 'Orthodox', 'W-Strawweight', 'USA')
zhang   = F('Zhang Weili', 'Magnum', 163, 163, 'Orthodox', 'W-Strawweight', 'China')
joanna  = F('Joanna Jedrzejczyk', 'JJ', 168, 163, 'Orthodox', 'W-Strawweight', 'Poland')
jedrzejczyk = joanna
andrade = F('Jéssica Andrade', 'Bate Estaca', 155, 157, 'Orthodox', 'W-Flyweight', 'Brazil')
deranda = F('Germaine de Randamie', 'The Iron Lady', 175, 180, 'Orthodox', 'W-Bantamweight', 'Netherlands')
pena    = F('Julianna Peña', 'The Venezuelan Vixen', 170, 170, 'Orthodox', 'W-Bantamweight', 'USA')
tate    = F('Miesha Tate', 'Cupcake', 168, 168, 'Orthodox', 'W-Bantamweight', 'USA')

# ============================================================
# EVENTS & FIGHTS
# ============================================================

# UFC 300 (Apr 13, 2024)
e = E(300, 'UFC 300: Pereira vs. Hill', '2024-04-13', 'T-Mobile Arena', 'Las Vegas, NV')
hill = F('Jamahal Hill', 'Sweet Dreams', 193, 196, 'Southpaw', 'Light Heavyweight', 'USA')
FIGHT(e, alex_p, hill, 'Light Heavyweight', True, True, 1, 'KO', 'Punch', 1, '1:14', alex_p)
holloway2 = holloway
FIGHT(e, gaethje, holloway, 'BMF Title', True, False, 2, 'KO', 'Punch', 5, '4:59', holloway)
bo_nickal = F('Bo Nickal', 'The Allen Assassin', 188, 193, 'Orthodox', 'Middleweight', 'USA')
FIGHT(e, zhang, yan_xiaonan := F('Yan Xiaonan', 'Fury', 163, 163, 'Orthodox', 'W-Strawweight', 'China'), 'W-Strawweight', True, False, 3, 'Decision', 'Unanimous', 5, '5:00', zhang)

# UFC 298 (Feb 17, 2024)
e = E(298, 'UFC 298: Volkanovski vs. Topuria', '2024-02-17', 'Honda Center', 'Anaheim, CA')
FIGHT(e, volk, topuria, 'Featherweight', True, True, 1, 'KO', 'Punches', 2, '3:32', topuria)
whittaker2 = whittaker
FIGHT(e, whittaker, du_plessis, 'Middleweight', False, False, 2, 'Decision', 'Split', 5, '5:00', du_plessis)

# UFC 295 (Nov 11, 2023)
e = E(295, 'UFC 295: Prochazka vs. Pereira', '2023-11-11', 'Madison Square Garden', 'New York, NY')
FIGHT(e, prochazka, alex_p, 'Light Heavyweight', True, True, 1, 'TKO', 'Punches', 2, '4:08', alex_p)
FIGHT(e, aspinall, sergei := F('Sergei Pavlovich', 'The Warlord', 191, 191, 'Orthodox', 'Heavyweight', 'Russia'), 'Heavyweight', True, False, 2, 'KO', 'Punch', 1, '0:55', aspinall)

# UFC 294 (Oct 21, 2023)
e = E(294, 'UFC 294: Makhachev vs. Volkanovski 2', '2023-10-21', 'Etihad Arena', 'Abu Dhabi', 'UAE')
FIGHT(e, makhachev, volk, 'Lightweight', True, True, 1, 'KO', 'Head Kick', 1, '3:06', makhachev)

# UFC 292 (Aug 19, 2023)
e = E(292, 'UFC 292: Sterling vs. O\'Malley', '2023-08-19', 'TD Garden', 'Boston, MA')
FIGHT(e, sterling, omalley, 'Bantamweight', True, True, 1, 'KO', 'Punch', 2, '2:51', omalley)
FIGHT(e, zhang, nunes_a := F('Amanda Lemos', 'Amandinha', 170, 170, 'Southpaw', 'W-Strawweight', 'Brazil'), 'W-Strawweight', True, False, 2, 'Submission', 'Rear Naked Choke', 2, '1:06', zhang)

# UFC 290 (Jul 8, 2023)
e = E(290, 'UFC 290: Volkanovski vs. Rodriguez', '2023-07-08', 'T-Mobile Arena', 'Las Vegas, NV')
yair = F('Yair Rodriguez', 'El Pantera', 180, 183, 'Orthodox', 'Featherweight', 'Mexico')
FIGHT(e, volk, yair, 'Featherweight', True, True, 1, 'Decision', 'Unanimous', 5, '5:00', volk)
FIGHT(e, moreno, pantoja, 'Flyweight', True, False, 2, 'Submission', 'Guillotine Choke', 4, '4:34', pantoja)

# UFC 288 (May 6, 2023)
e = E(288, 'UFC 288: Sterling vs. Cejudo', '2023-05-06', 'Prudential Center', 'Newark, NJ')
FIGHT(e, sterling, cejudo, 'Bantamweight', True, True, 1, 'Decision', 'Split', 5, '5:00', sterling)

# UFC 287 (Apr 8, 2023)
e = E(287, 'UFC 287: Pereira vs. Adesanya 2', '2023-04-08', 'Kaseya Center', 'Miami, FL')
FIGHT(e, alex_p, izzy, 'Middleweight', True, True, 1, 'KO', 'Punch', 2, '4:21', izzy)
FIGHT(e, masvidal, burns, 'Welterweight', False, False, 2, 'KO', 'Punch', 3, '1:26', burns)

# UFC 284 (Feb 12, 2023)
e = E(284, 'UFC 284: Makhachev vs. Volkanovski', '2023-02-12', 'RAC Arena', 'Perth', 'Australia')
FIGHT(e, makhachev, volk, 'Lightweight', True, True, 1, 'Decision', 'Unanimous', 5, '5:00', makhachev)

# UFC 283 (Jan 21, 2023)
e = E(283, 'UFC 283: Teixeira vs. Hill', '2023-01-21', 'Jeunesse Arena', 'Rio de Janeiro', 'Brazil')
FIGHT(e, glover, hill, 'Light Heavyweight', True, True, 1, 'Submission', 'Arm Triangle', 5, '0:51', hill)
FIGHT(e, figgy, moreno, 'Flyweight', True, False, 2, 'Decision', 'Unanimous', 5, '5:00', moreno)

# UFC 281 (Nov 12, 2022)
e = E(281, 'UFC 281: Adesanya vs. Pereira', '2022-11-12', 'Madison Square Garden', 'New York, NY')
FIGHT(e, izzy, alex_p, 'Middleweight', True, True, 1, 'TKO', 'Punches', 5, '2:01', alex_p)
FIGHT(e, zhang, esparza := F('Carla Esparza', 'Cookie Monster', 155, 157, 'Orthodox', 'W-Strawweight', 'USA'), 'W-Strawweight', True, False, 2, 'Submission', 'Rear Naked Choke', 2, '1:05', zhang)

# UFC 280 (Oct 22, 2022)
e = E(280, 'UFC 280: Oliveira vs. Makhachev', '2022-10-22', 'Etihad Arena', 'Abu Dhabi', 'UAE')
FIGHT(e, oliveira, makhachev, 'Lightweight', True, True, 1, 'Submission', 'Arm Triangle', 2, '3:16', makhachev)
FIGHT(e, sterling, dillashaw, 'Bantamweight', True, False, 2, 'TKO', 'Punches', 2, '3:44', sterling)
FIGHT(e, omalley, yan, 'Bantamweight', False, False, 3, 'Decision', 'Split', 3, '5:00', omalley)

# UFC 278 (Aug 20, 2022)
e = E(278, 'UFC 278: Usman vs. Edwards 2', '2022-08-20', 'Vivint Arena', 'Salt Lake City, UT')
FIGHT(e, usman, edwards, 'Welterweight', True, True, 1, 'KO', 'Head Kick', 5, '4:04', edwards)

# UFC 276 (Jul 2, 2022)
e = E(276, 'UFC 276: Adesanya vs. Cannonier', '2022-07-02', 'T-Mobile Arena', 'Las Vegas, NV')
cannonier = F('Jared Cannonier', 'The Killa Gorilla', 180, 191, 'Orthodox', 'Middleweight', 'USA')
FIGHT(e, izzy, cannonier, 'Middleweight', True, True, 1, 'Decision', 'Unanimous', 5, '5:00', izzy)
FIGHT(e, volk, holloway, 'Featherweight', True, False, 2, 'Decision', 'Unanimous', 5, '5:00', volk)

# UFC 274 (May 7, 2022)
e = E(274, 'UFC 274: Oliveira vs. Gaethje', '2022-05-07', 'Footprint Center', 'Phoenix, AZ')
FIGHT(e, oliveira, gaethje, 'Lightweight', True, True, 1, 'Submission', 'Rear Naked Choke', 1, '3:22', oliveira)
FIGHT(e, namajunas, esparza, 'W-Strawweight', True, False, 2, 'Decision', 'Split', 5, '5:00', esparza)
FIGHT(e, chandler, ferguson, 'Lightweight', False, False, 3, 'KO', 'Front Kick', 2, '0:17', chandler, 'Jason Herzog')

# UFC 273 (Apr 9, 2022)
e = E(273, 'UFC 273: Volkanovski vs. Korean Zombie', '2022-04-09', 'VyStar Veterans Memorial Arena', 'Jacksonville, FL')
FIGHT(e, volk, korean, 'Featherweight', True, True, 1, 'TKO', 'Ground and Pound', 4, '0:45', volk)
FIGHT(e, sterling, yan, 'Bantamweight', True, False, 2, 'Decision', 'Split', 5, '5:00', sterling)

# UFC 272 (Mar 5, 2022)
e = E(272, 'UFC 272: Covington vs. Masvidal', '2022-03-05', 'T-Mobile Arena', 'Las Vegas, NV')
FIGHT(e, covington, masvidal, 'Welterweight', False, True, 1, 'Decision', 'Unanimous', 5, '5:00', covington)

# UFC 271 (Feb 12, 2022)
e = E(271, 'UFC 271: Adesanya vs. Whittaker 2', '2022-02-12', 'Toyota Center', 'Houston, TX')
FIGHT(e, izzy, whittaker, 'Middleweight', True, True, 1, 'Decision', 'Unanimous', 5, '5:00', izzy)
FIGHT(e, lewis, tuivasa, 'Heavyweight', False, False, 2, 'KO', 'Elbow', 2, '1:30', tuivasa)

# UFC 270 (Jan 22, 2022)
e = E(270, 'UFC 270: Ngannou vs. Gane', '2022-01-22', 'Honda Center', 'Anaheim, CA')
FIGHT(e, ngannou, gane, 'Heavyweight', True, True, 1, 'Decision', 'Unanimous', 5, '5:00', ngannou)
FIGHT(e, moreno, figgy, 'Flyweight', True, False, 2, 'Decision', 'Unanimous', 5, '5:00', moreno)

# UFC 269 (Dec 11, 2021)
e = E(269, 'UFC 269: Oliveira vs. Poirier', '2021-12-11', 'T-Mobile Arena', 'Las Vegas, NV')
FIGHT(e, oliveira, poirier, 'Lightweight', True, True, 1, 'Submission', 'Rear Naked Choke', 3, '1:02', oliveira)
FIGHT(e, nunes, pena, 'W-Bantamweight', True, False, 2, 'Submission', 'Rear Naked Choke', 2, '3:22', pena)

# UFC 268 (Nov 6, 2021)
e = E(268, 'UFC 268: Usman vs. Covington 2', '2021-11-06', 'Madison Square Garden', 'New York, NY')
f = FIGHT(e, usman, covington, 'Welterweight', True, True, 1, 'Decision', 'Unanimous', 5, '5:00', usman)
STATS(f, usman, 166, 381, kd=1, td=0, tda=3, head=100, body=45, leg=21, dist=110, clinch=35, ground=21)
STATS(f, covington, 152, 345, kd=0, td=0, tda=0, head=95, body=35, leg=22, dist=105, clinch=30, ground=17)
FIGHT(e, namajunas, zhang, 'W-Strawweight', True, False, 2, 'Decision', 'Split', 5, '5:00', namajunas)
FIGHT(e, gaethje, chandler, 'Lightweight', False, False, 3, 'Decision', 'Unanimous', 3, '5:00', gaethje)

# UFC 267 (Oct 30, 2021)
e = E(267, 'UFC 267: Blachowicz vs. Teixeira', '2021-10-30', 'Etihad Arena', 'Abu Dhabi', 'UAE')
FIGHT(e, jan, glover, 'Light Heavyweight', True, True, 1, 'Submission', 'Rear Naked Choke', 2, '3:02', glover)
FIGHT(e, yan, sandhagen, 'Bantamweight', True, False, 2, 'Decision', 'Unanimous', 5, '5:00', yan)

# UFC 266 (Sep 25, 2021)
e = E(266, 'UFC 266: Volkanovski vs. Ortega', '2021-09-25', 'T-Mobile Arena', 'Las Vegas, NV')
FIGHT(e, volk, ortega, 'Featherweight', True, True, 1, 'Decision', 'Unanimous', 5, '5:00', volk)
FIGHT(e, shevchenko, murphy := F('Lauren Murphy', 'Lucky', 168, 163, 'Orthodox', 'W-Flyweight', 'USA'), 'W-Flyweight', True, False, 2, 'TKO', 'Ground and Pound', 4, '4:00', shevchenko)

# UFC 264 (Jul 10, 2021)
e = E(264, 'UFC 264: Poirier vs. McGregor 3', '2021-07-10', 'T-Mobile Arena', 'Las Vegas, NV')
FIGHT(e, poirier, mcgregor, 'Lightweight', False, True, 1, 'TKO', 'Doctor Stoppage (Broken Tibia)', 1, '5:00', poirier)

# UFC 263 (Jun 12, 2021)
e = E(263, 'UFC 263: Adesanya vs. Vettori 2', '2021-06-12', 'Gila River Arena', 'Glendale, AZ')
vettori = F('Marvin Vettori', 'The Italian Dream', 183, 191, 'Southpaw', 'Middleweight', 'Italy')
FIGHT(e, izzy, vettori, 'Middleweight', True, True, 1, 'Decision', 'Unanimous', 5, '5:00', izzy)
FIGHT(e, figgy, moreno, 'Flyweight', True, False, 2, 'Submission', 'Rear Naked Choke', 3, '2:26', moreno)
FIGHT(e, edwards, diaz := F('Nate Diaz', 'The Stockton Slugger', 183, 198, 'Southpaw', 'Welterweight', 'USA'), 'Welterweight', False, False, 3, 'Decision', 'Unanimous', 5, '5:00', edwards)

# UFC 261 (Apr 24, 2021)
e = E(261, 'UFC 261: Usman vs. Masvidal 2', '2021-04-24', 'VyStar Veterans Memorial Arena', 'Jacksonville, FL')
f = FIGHT(e, usman, masvidal, 'Welterweight', True, True, 1, 'KO', 'Punch', 2, '1:02', usman)
STATS(f, usman, 52, 95, kd=1, td=1, tda=2, ctrl=185, head=37, body=12, leg=2, dist=30, clinch=0, ground=22)
STATS(f, masvidal, 22, 62, kd=0, td=0, tda=1, head=9, body=2, leg=11, dist=19, clinch=0, ground=3)
FIGHT(e, zhang, namajunas, 'W-Strawweight', True, False, 2, 'KO', 'Head Kick', 1, '1:18', namajunas, 'Jason Herzog')
FIGHT(e, shevchenko, andrade, 'W-Flyweight', True, False, 3, 'TKO', 'Punches and Elbows', 2, '4:00', shevchenko)
FIGHT(e, weidman, hall, 'Middleweight', False, False, 4, 'TKO', 'Leg Injury', 1, '0:17', hall)

# UFC 259 (Mar 6, 2021)
e = E(259, 'UFC 259: Blachowicz vs. Adesanya', '2021-03-06', 'UFC APEX', 'Las Vegas, NV')
FIGHT(e, jan, izzy, 'Light Heavyweight', True, True, 1, 'Decision', 'Unanimous', 5, '5:00', jan)
FIGHT(e, nunes, anderson_m := F('Megan Anderson', 'The Squeeze', 183, 183, 'Orthodox', 'W-Featherweight', 'Australia'), 'W-Featherweight', True, False, 2, 'Submission', 'Triangle Armbar', 1, '2:03', nunes)
FIGHT(e, yan, sterling, 'Bantamweight', True, False, 3, 'DQ', 'Illegal Knee', 4, '4:29', sterling)

# UFC 258 (Feb 13, 2021)
e = E(258, 'UFC 258: Usman vs. Burns', '2021-02-13', 'UFC APEX', 'Las Vegas, NV')
FIGHT(e, usman, burns, 'Welterweight', True, True, 1, 'TKO', 'Punches', 3, '0:34', usman)

# UFC 257 (Jan 23, 2021)
e = E(257, 'UFC 257: Poirier vs. McGregor 2', '2021-01-23', 'Etihad Arena', 'Abu Dhabi', 'UAE')
FIGHT(e, poirier, mcgregor, 'Lightweight', False, True, 1, 'TKO', 'Punches', 2, '2:32', poirier)
FIGHT(e, chandler, hooker := F('Dan Hooker', 'The Hangman', 183, 193, 'Orthodox', 'Lightweight', 'New Zealand'), 'Lightweight', False, False, 2, 'KO', 'Punch', 1, '2:30', chandler)

# UFC 254 (Oct 24, 2020)
e = E(254, 'UFC 254: Khabib vs. Gaethje', '2020-10-24', 'Flash Forum', 'Abu Dhabi', 'UAE')
f = FIGHT(e, khabib, gaethje, 'Lightweight', True, True, 1, 'Submission', 'Triangle Choke', 2, '1:34', khabib)

# UFC 253 (Sep 27, 2020)
e = E(253, 'UFC 253: Adesanya vs. Costa', '2020-09-27', 'Flash Forum', 'Abu Dhabi', 'UAE')
FIGHT(e, izzy, costa, 'Middleweight', True, True, 1, 'TKO', 'Punches', 2, '3:59', izzy)
FIGHT(e, reyes, jan, 'Light Heavyweight', True, False, 2, 'Decision', 'Unanimous', 5, '5:00', jan)

# UFC 251 (Jul 12, 2020)
e = E(251, 'UFC 251: Usman vs. Masvidal', '2020-07-12', 'Flash Forum', 'Abu Dhabi', 'UAE')
FIGHT(e, usman, masvidal, 'Welterweight', True, True, 1, 'Decision', 'Unanimous', 5, '5:00', usman)
FIGHT(e, volk, holloway, 'Featherweight', True, False, 2, 'Decision', 'Split', 5, '5:00', volk)
FIGHT(e, yan, aldo, 'Bantamweight', True, False, 3, 'TKO', 'Punches', 5, '3:24', yan)

# UFC 249 (May 9, 2020)
e = E(249, 'UFC 249: Ferguson vs. Gaethje', '2020-05-09', 'VyStar Veterans Memorial Arena', 'Jacksonville, FL')
FIGHT(e, ferguson, gaethje, 'Lightweight', True, True, 1, 'TKO', 'Punches (corner stoppage)', 5, '3:39', gaethje)
FIGHT(e, cejudo, cruz, 'Bantamweight', True, False, 2, 'TKO', 'Punches', 2, '4:58', cejudo)
FIGHT(e, ngannou, rozenstruik := F('Jairzinho Rozenstruik', 'Bigi Boy', 188, 196, 'Orthodox', 'Heavyweight', 'Suriname'), 'Heavyweight', False, False, 3, 'KO', 'Punch', 1, '0:20', ngannou)

# UFC 248 (Mar 7, 2020)
e = E(248, 'UFC 248: Adesanya vs. Romero', '2020-03-07', 'T-Mobile Arena', 'Las Vegas, NV')
romero = F('Yoel Romero', 'Soldier of God', 183, 185, 'Southpaw', 'Middleweight', 'Cuba')
FIGHT(e, izzy, romero, 'Middleweight', True, True, 1, 'Decision', 'Unanimous', 5, '5:00', izzy)
FIGHT(e, zhang, joanna, 'W-Strawweight', True, False, 2, 'Decision', 'Split', 5, '5:00', zhang)

# UFC 246 (Jan 18, 2020)
e = E(246, 'UFC 246: McGregor vs. Cowboy', '2020-01-18', 'T-Mobile Arena', 'Las Vegas, NV')
FIGHT(e, mcgregor, cerrone, 'Welterweight', False, True, 1, 'TKO', 'Head Kick + Punches', 1, '0:40', mcgregor)
FIGHT(e, holm, pennington := F('Raquel Pennington', 'Rocky', 168, 170, 'Orthodox', 'W-Bantamweight', 'USA'), 'W-Bantamweight', False, False, 2, 'Decision', 'Unanimous', 3, '5:00', holm)

# UFC 245 (Dec 14, 2019) — THE SHOWCASE FIGHT
e = E(245, 'UFC 245: Usman vs. Covington', '2019-12-14', 'T-Mobile Arena', 'Las Vegas, NV')
f = FIGHT(e, usman, covington, 'Welterweight', True, True, 1, 'TKO', 'Punches', 5, '4:10', usman, 'Marc Goddard')
STATS(f, usman, 175, 360, kd=2, td=0, tda=1, head=105, body=53, leg=17, dist=120, clinch=44, ground=11)
STATS(f, covington, 143, 395, kd=0, td=0, tda=0, head=92, body=32, leg=19, dist=110, clinch=22, ground=11)
FIGHT(e, volk, holloway, 'Featherweight', True, False, 2, 'Decision', 'Unanimous (48-47, 48-47, 48-47)', 5, '5:00', volk)
FIGHT(e, nunes, deranda, 'W-Bantamweight', True, False, 3, 'TKO', 'Head Kick + Punches', 1, '4:51', nunes, 'Jason Herzog')
FIGHT(e, moraes, aldo, 'Bantamweight', False, False, 4, 'Decision', 'Split (29-28, 28-29, 29-28)', 3, '5:00', moraes, 'Mark Smith')

# UFC 243 (Oct 6, 2019)
e = E(243, 'UFC 243: Whittaker vs. Adesanya', '2019-10-06', 'Marvel Stadium', 'Melbourne', 'Australia')
FIGHT(e, whittaker, izzy, 'Middleweight', True, True, 1, 'KO', 'Punch', 2, '3:33', izzy)

# UFC 242 (Sep 7, 2019)
e = E(242, 'UFC 242: Khabib vs. Poirier', '2019-09-07', 'The Arena', 'Abu Dhabi', 'UAE')
FIGHT(e, khabib, poirier, 'Lightweight', True, True, 1, 'Submission', 'Rear Naked Choke', 3, '2:06', khabib)

# UFC 241 (Aug 17, 2019)
e = E(241, 'UFC 241: Cormier vs. Miocic 2', '2019-08-17', 'Honda Center', 'Anaheim, CA')
FIGHT(e, dc, stipe, 'Heavyweight', True, True, 1, 'KO', 'Punches', 4, '4:09', stipe)
FIGHT(e, diaz, pettis, 'Welterweight', False, False, 2, 'Decision', 'Unanimous', 3, '5:00', diaz)

# UFC 239 (Jul 6, 2019)
e = E(239, 'UFC 239: Jones vs. Santos', '2019-07-06', 'T-Mobile Arena', 'Las Vegas, NV')
santos = F('Thiago Santos', 'Marreta', 188, 191, 'Orthodox', 'Light Heavyweight', 'Brazil')
FIGHT(e, jones, santos, 'Light Heavyweight', True, True, 1, 'Decision', 'Split', 5, '5:00', jones)
FIGHT(e, nunes, holm, 'W-Bantamweight', True, False, 2, 'KO', 'Head Kick', 1, '4:10', nunes)

# UFC 236 (Apr 13, 2019)
e = E(236, 'UFC 236: Holloway vs. Poirier 2', '2019-04-13', 'State Farm Arena', 'Atlanta, GA')
FIGHT(e, holloway, poirier, 'Lightweight', True, True, 1, 'Decision', 'Unanimous', 5, '5:00', poirier)
FIGHT(e, gastelum, izzy, 'Middleweight', True, False, 2, 'Decision', 'Unanimous', 5, '5:00', izzy)

# UFC 235 (Mar 2, 2019)
e = E(235, 'UFC 235: Jones vs. Smith', '2019-03-02', 'T-Mobile Arena', 'Las Vegas, NV')
FIGHT(e, jones, smith, 'Light Heavyweight', True, True, 1, 'Decision', 'Unanimous', 5, '5:00', jones)
FIGHT(e, usman, woodley, 'Welterweight', True, False, 2, 'Decision', 'Unanimous', 5, '5:00', usman)
FIGHT(e, askren, lawler, 'Welterweight', False, False, 3, 'Submission', 'Bulldog Choke', 1, '3:20', askren)

# UFC 232 (Dec 29, 2018)
e = E(232, 'UFC 232: Jones vs. Gustafsson 2', '2018-12-29', 'The Forum', 'Inglewood, CA')
gust = F('Alexander Gustafsson', 'The Mauler', 196, 203, 'Orthodox', 'Light Heavyweight', 'Sweden')
FIGHT(e, jones, gust, 'Light Heavyweight', True, True, 1, 'TKO', 'Ground and Pound', 3, '2:02', jones)
FIGHT(e, nunes, cyborg := F('Cris Cyborg', 'Cyborg', 173, 175, 'Orthodox', 'W-Featherweight', 'Brazil'), 'W-Featherweight', True, False, 2, 'KO', 'Punches', 1, '0:51', nunes)

# UFC 229 (Oct 6, 2018)
e = E(229, 'UFC 229: Khabib vs. McGregor', '2018-10-06', 'T-Mobile Arena', 'Las Vegas, NV')
f = FIGHT(e, khabib, mcgregor, 'Lightweight', True, True, 1, 'Submission', 'Rear Naked Choke', 4, '3:03', khabib)
STATS(f, khabib, 70, 119, kd=0, td=3, tda=7, ctrl=734, sub=1, head=58, body=11, leg=1, dist=24, clinch=1, ground=45)
STATS(f, mcgregor, 51, 81, kd=0, td=0, tda=0, head=34, body=16, leg=1, dist=35, clinch=10, ground=6)
FIGHT(e, ferguson, pettis, 'Lightweight', False, False, 2, 'TKO', 'Corner Stoppage', 2, '5:00', ferguson, 'Jason Herzog')
FIGHT(e, lewis, volkov, 'Heavyweight', False, False, 3, 'KO', 'Punches', 3, '4:49', lewis)

# UFC 226 (Jul 7, 2018)
e = E(226, 'UFC 226: Miocic vs. Cormier', '2018-07-07', 'T-Mobile Arena', 'Las Vegas, NV')
FIGHT(e, stipe, dc, 'Heavyweight', True, True, 1, 'KO', 'Punch', 1, '4:33', dc)
FIGHT(e, ngannou, lewis, 'Heavyweight', False, False, 2, 'Decision', 'Unanimous', 3, '5:00', lewis)

# UFC 223 (Apr 7, 2018)
e = E(223, 'UFC 223: Khabib vs. Iaquinta', '2018-04-07', 'Barclays Center', 'Brooklyn, NY')
iaquinta = F('Al Iaquinta', 'Raging Al', 180, 183, 'Southpaw', 'Lightweight', 'USA')
FIGHT(e, khabib, iaquinta, 'Lightweight', True, True, 1, 'Decision', 'Unanimous', 5, '5:00', khabib)
FIGHT(e, namajunas, joanna, 'W-Strawweight', True, False, 2, 'Decision', 'Unanimous', 5, '5:00', namajunas)

# UFC 220 (Jan 20, 2018)
e = E(220, 'UFC 220: Miocic vs. Ngannou', '2018-01-20', 'TD Garden', 'Boston, MA')
FIGHT(e, stipe, ngannou, 'Heavyweight', True, True, 1, 'Decision', 'Unanimous', 5, '5:00', stipe)
FIGHT(e, dc, volkan := F('Volkan Oezdemir', 'No Time', 183, 185, 'Orthodox', 'Light Heavyweight', 'Switzerland'), 'Light Heavyweight', True, False, 2, 'TKO', 'Punches', 2, '2:00', dc)

# UFC 217 (Nov 4, 2017)
e = E(217, 'UFC 217: Bisping vs. St-Pierre', '2017-11-04', 'Madison Square Garden', 'New York, NY')
FIGHT(e, bisping, gsp, 'Middleweight', True, True, 1, 'Submission', 'Rear Naked Choke', 3, '4:23', gsp)
FIGHT(e, dillashaw, garbrandt, 'Bantamweight', True, False, 2, 'KO', 'Punches', 2, '4:10', dillashaw)
FIGHT(e, namajunas, joanna, 'W-Strawweight', True, False, 3, 'KO', 'Punches', 1, '3:03', namajunas)

# UFC 214 (Jul 29, 2017)
e = E(214, 'UFC 214: Cormier vs. Jones 2', '2017-07-29', 'Honda Center', 'Anaheim, CA')
FIGHT(e, dc, jones, 'Light Heavyweight', True, True, 1, 'KO', 'Head Kick', 3, '3:01', jones)
FIGHT(e, woodley, thompson, 'Welterweight', True, False, 2, 'Decision', 'Majority', 5, '5:00', woodley)
FIGHT(e, cyborg, tonya := F('Tonya Evinger', 'Triple Threat', 168, 165, 'Orthodox', 'W-Featherweight', 'USA'), 'W-Featherweight', True, False, 3, 'TKO', 'Punches', 3, '2:53', cyborg)

# UFC 212 (Jun 3, 2017)
e = E(212, 'UFC 212: Aldo vs. Holloway', '2017-06-03', 'Jeunesse Arena', 'Rio de Janeiro', 'Brazil')
FIGHT(e, aldo, holloway, 'Featherweight', True, True, 1, 'TKO', 'Punches', 3, '4:13', holloway)

# UFC 209 (Mar 4, 2017)
e = E(209, 'UFC 209: Woodley vs. Thompson 2', '2017-03-04', 'T-Mobile Arena', 'Las Vegas, NV')
FIGHT(e, woodley, thompson, 'Welterweight', True, True, 1, 'Decision', 'Majority', 5, '5:00', woodley)

# UFC 207 (Dec 30, 2016)
e = E(207, 'UFC 207: Nunes vs. Rousey', '2016-12-30', 'T-Mobile Arena', 'Las Vegas, NV')
FIGHT(e, nunes, rousey, 'W-Bantamweight', True, True, 1, 'TKO', 'Punches', 1, '0:48', nunes)
FIGHT(e, garbrandt, cruz, 'Bantamweight', True, False, 2, 'Decision', 'Unanimous', 5, '5:00', garbrandt)

# UFC 205 (Nov 12, 2016) - first MSG event
e = E(205, 'UFC 205: Alvarez vs. McGregor', '2016-11-12', 'Madison Square Garden', 'New York, NY')
FIGHT(e, alvarez, mcgregor, 'Lightweight', True, True, 1, 'TKO', 'Punches', 2, '3:04', mcgregor)
FIGHT(e, woodley, thompson, 'Welterweight', True, False, 2, 'Decision', 'Majority Draw', 5, '5:00', woodley)
FIGHT(e, joanna, karolina := F('Karolina Kowalkiewicz', 'KK', 163, 163, 'Orthodox', 'W-Strawweight', 'Poland'), 'W-Strawweight', True, False, 3, 'Decision', 'Unanimous', 5, '5:00', joanna)

# UFC 202 (Aug 20, 2016)
e = E(202, 'UFC 202: Diaz vs. McGregor 2', '2016-08-20', 'T-Mobile Arena', 'Las Vegas, NV')
FIGHT(e, diaz, mcgregor, 'Welterweight', False, True, 1, 'Decision', 'Majority', 5, '5:00', mcgregor)

# UFC 200 (Jul 9, 2016)
e = E(200, 'UFC 200: Tate vs. Nunes', '2016-07-09', 'T-Mobile Arena', 'Las Vegas, NV')
FIGHT(e, tate, nunes, 'W-Bantamweight', True, True, 1, 'Submission', 'Rear Naked Choke', 1, '3:16', nunes)
FIGHT(e, dc, silva, 'Light Heavyweight', False, False, 2, 'Decision', 'Unanimous', 3, '5:00', dc)
FIGHT(e, lesnar := F('Brock Lesnar', 'The Beast Incarnate', 191, 203, 'Orthodox', 'Heavyweight', 'USA'), overeem, 'Heavyweight', False, False, 3, 'Decision', 'Unanimous', 3, '5:00', lesnar)

# UFC 196 (Mar 5, 2016)
e = E(196, 'UFC 196: McGregor vs. Diaz', '2016-03-05', 'MGM Grand', 'Las Vegas, NV')
FIGHT(e, mcgregor, diaz, 'Welterweight', False, True, 1, 'Submission', 'Rear Naked Choke', 2, '4:12', diaz)
FIGHT(e, tate, holm, 'W-Bantamweight', True, False, 2, 'Submission', 'Rear Naked Choke', 5, '3:30', tate)

# UFC 194 (Dec 12, 2015) - 13 second KO
e = E(194, 'UFC 194: Aldo vs. McGregor', '2015-12-12', 'MGM Grand Garden Arena', 'Las Vegas, NV')
FIGHT(e, aldo, mcgregor, 'Featherweight', True, True, 1, 'KO', 'Punch', 1, '0:13', mcgregor, 'John McCarthy')
FIGHT(e, weidman, rockhold, 'Middleweight', True, False, 2, 'TKO', 'Punches', 4, '3:12', rockhold)
FIGHT(e, weidman2 := gastelum, jacare := F('Ronaldo Souza', 'Jacaré', 185, 188, 'Orthodox', 'Middleweight', 'Brazil'), 'Middleweight', False, False, 3, 'Decision', 'Split', 3, '5:00', gastelum)

# UFC 193 (Nov 15, 2015)
e = E(193, 'UFC 193: Rousey vs. Holm', '2015-11-15', 'Etihad Stadium', 'Melbourne', 'Australia')
FIGHT(e, rousey, holm, 'W-Bantamweight', True, True, 1, 'KO', 'Head Kick', 2, '0:59', holm)

# UFC 189 (Jul 11, 2015)
e = E(189, 'UFC 189: Mendes vs. McGregor', '2015-07-11', 'MGM Grand', 'Las Vegas, NV')
mendes = F('Chad Mendes', 'Money', 168, 170, 'Orthodox', 'Featherweight', 'USA')
FIGHT(e, mendes, mcgregor, 'Featherweight', True, True, 1, 'TKO', 'Punches', 2, '4:57', mcgregor, 'Herb Dean')
FIGHT(e, lawler, macdonald := F('Rory MacDonald', 'Red King', 183, 193, 'Orthodox', 'Welterweight', 'Canada'), 'Welterweight', True, False, 2, 'TKO', 'Punches', 5, '4:59', lawler)

# UFC 187 (May 23, 2015)
e = E(187, 'UFC 187: Johnson vs. Cormier', '2015-05-23', 'MGM Grand', 'Las Vegas, NV')
FIGHT(e, rumble, dc, 'Light Heavyweight', True, True, 1, 'Submission', 'Rear Naked Choke', 3, '2:39', dc)
FIGHT(e, weidman, vitor := F('Vitor Belfort', 'The Phenom', 183, 188, 'Orthodox', 'Middleweight', 'Brazil'), 'Middleweight', True, False, 2, 'TKO', 'Punches', 1, '2:53', weidman)

# UFC 182 (Jan 3, 2015)
e = E(182, 'UFC 182: Jones vs. Cormier', '2015-01-03', 'MGM Grand', 'Las Vegas, NV')
FIGHT(e, jones, dc, 'Light Heavyweight', True, True, 1, 'Decision', 'Unanimous', 5, '5:00', jones)

# UFC 168 (Dec 28, 2013)
e = E(168, 'UFC 168: Weidman vs. Silva 2', '2013-12-28', 'MGM Grand', 'Las Vegas, NV')
FIGHT(e, weidman, silva, 'Middleweight', True, True, 1, 'TKO', 'Leg Injury (Checked Kick)', 2, '1:16', weidman)
FIGHT(e, rousey, tate, 'W-Bantamweight', True, False, 2, 'Submission', 'Armbar', 3, '0:58', rousey)

# UFC 162 (Jul 6, 2013)
e = E(162, 'UFC 162: Silva vs. Weidman', '2013-07-06', 'MGM Grand', 'Las Vegas, NV')
FIGHT(e, silva, weidman, 'Middleweight', True, True, 1, 'KO', 'Punch', 2, '1:18', weidman)

# UFC 309 (Nov 16, 2024)
e = E(309, 'UFC 309: Jones vs. Miocic', '2024-11-16', 'Madison Square Garden', 'New York, NY')
FIGHT(e, jones, stipe, 'Heavyweight', True, True, 1, 'TKO', 'Spinning Back Kick + Ground and Pound', 3, '4:29', jones)

# UFC 306 (Sep 14, 2024)
e = E(306, 'UFC 306: O\'Malley vs. Dvalishvili', '2024-09-14', 'Sphere', 'Las Vegas, NV')
FIGHT(e, omalley, merab, 'Bantamweight', True, True, 1, 'Decision', 'Unanimous', 5, '5:00', merab)
FIGHT(e, shevchenko, fiorot := F('Manon Fiorot', 'The Beast', 165, 168, 'Orthodox', 'W-Flyweight', 'France'), 'W-Flyweight', True, False, 2, 'Decision', 'Unanimous', 5, '5:00', shevchenko)

# UFC 303 (Jun 29, 2024)
e = E(303, 'UFC 303: Pereira vs. Prochazka 2', '2024-06-29', 'T-Mobile Arena', 'Las Vegas, NV')
FIGHT(e, alex_p, prochazka, 'Light Heavyweight', True, True, 1, 'KO', 'Head Kick', 2, '1:08', alex_p)

# UFC 302 (Jun 1, 2024)
e = E(302, 'UFC 302: Makhachev vs. Poirier', '2024-06-01', 'Prudential Center', 'Newark, NJ')
FIGHT(e, makhachev, poirier, 'Lightweight', True, True, 1, 'Submission', 'D\'Arce Choke', 5, '4:11', makhachev)
FIGHT(e, strickland, costa, 'Middleweight', False, False, 2, 'Decision', 'Unanimous', 5, '5:00', strickland)

# ============================================================
# OUTPUT
# ============================================================
# Load existing biomechanics templates
import os
bio_templates = {}
existing = os.path.join(os.path.dirname(__file__), 'seed.json')
if os.path.exists(existing):
    with open(existing) as f:
        old = json.load(f)
        bio_templates = old.get('biomechanics_templates', {})

output = {
    'fighters': list(fighters.values()),
    'events': events,
    'fights': fights,
    'fight_stats': fight_stats_list,
    'biomechanics_templates': bio_templates
}

out_path = os.path.join(os.path.dirname(__file__), 'seed.json')
with open(out_path, 'w') as f:
    json.dump(output, f, indent=2)

print(f"Generated: {len(fighters)} fighters, {len(events)} events, {len(fights)} fights, {len(fight_stats_list)} stat entries")
