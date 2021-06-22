import {Address, BigDecimal, BigInt, dataSource, ethereum, log} from '@graphprotocol/graph-ts'
import {Bar, History, User} from '../generated/schema'
import {rUNNToken as RUNNBarContract, Transfer} from '../generated/rUNNToken/rUNNToken'
import {IERC20 as UNNTokenContract} from "../generated/rUNNToken/IERC20";

const ADDRESS_ZERO  = Address.fromString('0x0000000000000000000000000000000000000000')

const BIG_DECIMAL_1E18 = BigDecimal.fromString('1e18')
const BIG_DECIMAL_1E6 = BigDecimal.fromString('1e6')
const BIG_DECIMAL_ZERO = BigDecimal.fromString('0')
const UNN_BAR_ADDRESS = Address.fromString('0x2A21d8AfEA039506db5d05F478250edC2424f325');
const UNN_TOKEN_ADDRESS = Address.fromString('0xc2b2602344d5Ca808F888954f30fCb2B5E13A08F');

function createBar(block: ethereum.Block): Bar {
  const contract = RUNNBarContract.bind(dataSource.address())
  const bar = new Bar(dataSource.address().toHex())
  bar.decimals = contract.decimals()
  bar.name = contract.name()
  bar.symbol = contract.symbol()
  bar.totalSupply = BIG_DECIMAL_ZERO
  bar.UNNStaked = BIG_DECIMAL_ZERO
  bar.UNNHarvested = BIG_DECIMAL_ZERO
  bar.xUNNMinted = BIG_DECIMAL_ZERO
  bar.xUNNBurned = BIG_DECIMAL_ZERO
  bar.xUNNAge = BIG_DECIMAL_ZERO
  bar.xUNNAgeDestroyed = BIG_DECIMAL_ZERO
  bar.ratio = BIG_DECIMAL_ZERO
  bar.updatedAt = block.timestamp
  bar.save()

  return bar as Bar
}

function getBar(block: ethereum.Block): Bar {
  let bar = Bar.load(dataSource.address().toHex())

  if (bar === null) {
    bar = createBar(block)
  }

  return bar as Bar
}

function createUser(address: Address, block: ethereum.Block): User {
  const user = new User(address.toHex())

  // Set relation to bar
  user.bar = dataSource.address().toHex()

  user.xUNN = BIG_DECIMAL_ZERO
  user.xUNNMinted = BIG_DECIMAL_ZERO
  user.xUNNBurned = BIG_DECIMAL_ZERO

  user.UNNStaked = BIG_DECIMAL_ZERO

  user.UNNHarvested = BIG_DECIMAL_ZERO

  // In/Out
  user.xUNNOut = BIG_DECIMAL_ZERO
  user.UNNOut = BIG_DECIMAL_ZERO

  user.xUNNIn = BIG_DECIMAL_ZERO
  user.UNNIn = BIG_DECIMAL_ZERO

  user.xUNNAge = BIG_DECIMAL_ZERO
  user.xUNNAgeDestroyed = BIG_DECIMAL_ZERO

  user.xUNNOffset = BIG_DECIMAL_ZERO
  user.UNNOffset = BIG_DECIMAL_ZERO
  user.usdOffset = BIG_DECIMAL_ZERO
  user.updatedAt = block.timestamp

  return user as User
}

function getUser(address: Address, block: ethereum.Block): User {
  let user = User.load(address.toHex())

  if (user === null) {
    user = createUser(address, block)
  }

  return user as User
}

function getHistory(block: ethereum.Block): History {
  const day = block.timestamp.toI32() / 86400

  const id = BigInt.fromI32(day).toString()

  let history = History.load(id)

  if (history === null) {
    const date = day * 86400
    history = new History(id)
    history.date = date
    history.timeframe = 'Day'
    history.UNNStaked = BIG_DECIMAL_ZERO
    history.UNNHarvested = BIG_DECIMAL_ZERO
    history.xUNNAge = BIG_DECIMAL_ZERO
    history.xUNNAgeDestroyed = BIG_DECIMAL_ZERO
    history.xUNNMinted = BIG_DECIMAL_ZERO
    history.xUNNBurned = BIG_DECIMAL_ZERO
    history.xUNNSupply = BIG_DECIMAL_ZERO
    history.ratio = BIG_DECIMAL_ZERO
  }

  return history as History
}

export function handleTransfer(event: Transfer): void {
  // Convert to BigDecimal with 18 places, 1e18.
  const value = event.params.value.divDecimal(BIG_DECIMAL_1E18)

  // If value is zero, do nothing.
  if (value.equals(BIG_DECIMAL_ZERO)) {
    log.warning('Transfer zero value! Value: {} Tx: {}', [
      event.params.value.toString(),
      event.transaction.hash.toHex(),
    ])
    return
  }

  const bar = getBar(event.block)
  const barContract = RUNNBarContract.bind(UNN_BAR_ADDRESS)

  bar.totalSupply = barContract.totalSupply().divDecimal(BIG_DECIMAL_1E18)
  bar.UNNStaked = UNNTokenContract.bind(UNN_TOKEN_ADDRESS)
      .balanceOf(UNN_BAR_ADDRESS)
      .divDecimal(BIG_DECIMAL_1E18)
  bar.ratio = bar.UNNStaked.div(bar.totalSupply)

  const what = value.times(bar.ratio)

  // Minted xUNN
  if (event.params.from == ADDRESS_ZERO) {
    const user = getUser(event.params.to, event.block)

    log.info('{} minted {} xUNN in exchange for {} UNN - UNNStaked before {} UNNStaked after {}', [
      event.params.to.toHex(),
      value.toString(),
      what.toString(),
      user.UNNStaked.toString(),
      user.UNNStaked.plus(what).toString(),
    ])

    if (user.xUNN == BIG_DECIMAL_ZERO) {
      log.info('{} entered the bar', [user.id])
      user.bar = bar.id
    }

    user.xUNNMinted = user.xUNNMinted.plus(value)

    user.UNNStaked = user.UNNStaked.plus(what)

    const days = event.block.timestamp.minus(user.updatedAt).divDecimal(BigDecimal.fromString('86400'))

    const xUNNAge = days.times(user.xUNN)

    user.xUNNAge = user.xUNNAge.plus(xUNNAge)

    // Update last
    user.xUNN = user.xUNN.plus(value)

    user.updatedAt = event.block.timestamp

    user.save()

    const barDays = event.block.timestamp.minus(bar.updatedAt).divDecimal(BigDecimal.fromString('86400'))
    const barXUNN = bar.xUNNMinted.minus(bar.xUNNBurned)
    bar.xUNNMinted = bar.xUNNMinted.plus(value)
    bar.xUNNAge = bar.xUNNAge.plus(barDays.times(barXUNN))
    bar.UNNStaked = bar.UNNStaked.plus(what)
    bar.updatedAt = event.block.timestamp

    const history = getHistory(event.block)
    history.xUNNAge = bar.xUNNAge
    history.xUNNMinted = history.xUNNMinted.plus(value)
    history.xUNNSupply = bar.totalSupply
    history.UNNStaked = history.UNNStaked.plus(what)
    history.ratio = bar.ratio
    history.save()
  }

  // Burned xUNN
  if (event.params.to == ADDRESS_ZERO) {
    log.info('{} burned {} xUNN', [event.params.from.toHex(), value.toString()])

    const user = getUser(event.params.from, event.block)

    user.xUNNBurned = user.xUNNBurned.plus(value)

    user.UNNHarvested = user.UNNHarvested.plus(what)

    const days = event.block.timestamp.minus(user.updatedAt).divDecimal(BigDecimal.fromString('86400'))

    const xUNNAge = days.times(user.xUNN)

    user.xUNNAge = user.xUNNAge.plus(xUNNAge)

    const xUNNAgeDestroyed = user.xUNNAge.div(user.xUNN).times(value)

    user.xUNNAgeDestroyed = user.xUNNAgeDestroyed.plus(xUNNAgeDestroyed)

    // remove xUNNAge
    user.xUNNAge = user.xUNNAge.minus(xUNNAgeDestroyed)
    // Update xUNN last
    user.xUNN = user.xUNN.minus(value)

    if (user.xUNN == BIG_DECIMAL_ZERO) {
      log.info('{} left the bar', [user.id])
      user.bar = null
    }

    user.updatedAt = event.block.timestamp

    user.save()

    const barDays = event.block.timestamp.minus(bar.updatedAt).divDecimal(BigDecimal.fromString('86400'))
    const barXUNN = bar.xUNNMinted.minus(bar.xUNNBurned)
    bar.xUNNBurned = bar.xUNNBurned.plus(value)
    bar.xUNNAge = bar.xUNNAge.plus(barDays.times(barXUNN)).minus(xUNNAgeDestroyed)
    bar.xUNNAgeDestroyed = bar.xUNNAgeDestroyed.plus(xUNNAgeDestroyed)
    bar.UNNHarvested = bar.UNNHarvested.plus(what)
    bar.updatedAt = event.block.timestamp

    const history = getHistory(event.block)
    history.xUNNSupply = bar.totalSupply
    history.xUNNBurned = history.xUNNBurned.plus(value)
    history.xUNNAge = bar.xUNNAge
    history.xUNNAgeDestroyed = history.xUNNAgeDestroyed.plus(xUNNAgeDestroyed)
    history.UNNHarvested = history.UNNHarvested.plus(what)
    history.ratio = bar.ratio
    history.save()
  }

  // If transfer from address to address and not known xUNN pools.
  if (event.params.from != ADDRESS_ZERO && event.params.to != ADDRESS_ZERO) {
    log.info('transfered {} xUNN from {} to {}', [
      value.toString(),
      event.params.from.toHex(),
      event.params.to.toHex(),
    ])

    const fromUser = getUser(event.params.from, event.block)

    const fromUserDays = event.block.timestamp.minus(fromUser.updatedAt).divDecimal(BigDecimal.fromString('86400'))

    // Recalc xUNN age first
    fromUser.xUNNAge = fromUser.xUNNAge.plus(fromUserDays.times(fromUser.xUNN))
    // Calculate xUNNAge being transfered
    const xUNNAgeTranfered = fromUser.xUNNAge.div(fromUser.xUNN).times(value)
    // Subtract from xUNNAge
    fromUser.xUNNAge = fromUser.xUNNAge.minus(xUNNAgeTranfered)
    fromUser.updatedAt = event.block.timestamp

    fromUser.xUNN = fromUser.xUNN.minus(value)
    fromUser.xUNNOut = fromUser.xUNNOut.plus(value)
    fromUser.UNNOut = fromUser.UNNOut.plus(what)

    if (fromUser.xUNN == BIG_DECIMAL_ZERO) {
      log.info('{} left the bar by transfer OUT', [fromUser.id])
      fromUser.bar = null
    }

    fromUser.save()

    const toUser = getUser(event.params.to, event.block)

    if (toUser.bar === null) {
      log.info('{} entered the bar by transfer IN', [fromUser.id])
      toUser.bar = bar.id
    }

    // Recalculate xUNN age and add incoming xUNNAgeTransfered
    const toUserDays = event.block.timestamp.minus(toUser.updatedAt).divDecimal(BigDecimal.fromString('86400'))

    toUser.xUNNAge = toUser.xUNNAge.plus(toUserDays.times(toUser.xUNN)).plus(xUNNAgeTranfered)
    toUser.updatedAt = event.block.timestamp

    toUser.xUNN = toUser.xUNN.plus(value)
    toUser.xUNNIn = toUser.xUNNIn.plus(value)
    toUser.UNNIn = toUser.UNNIn.plus(what)

    const difference = toUser.xUNNIn.minus(toUser.xUNNOut).minus(toUser.xUNNOffset)

    // If difference of UNN in - UNN out - offset > 0, then add on the difference
    // in staked UNN based on xUNN:UNN ratio at time of reciept.
    if (difference.gt(BIG_DECIMAL_ZERO)) {
      const UNN = toUser.UNNIn.minus(toUser.UNNOut).minus(toUser.UNNOffset)

      log.info('{} recieved a transfer of {} xUNN from {}, UNN value of transfer is {}', [
        toUser.id,
        value.toString(),
        fromUser.id,
        what.toString(),
      ])

      toUser.UNNStaked = toUser.UNNStaked.plus(UNN)

      toUser.xUNNOffset = toUser.xUNNOffset.plus(difference)
      toUser.UNNOffset = toUser.UNNOffset.plus(UNN)
    }

    toUser.save()
  }

  bar.save()
}

